import type { NormalizedSession } from "../adapters/types.js";
import type { AggregateResult } from "../aggregate.js";
import type { Attribution } from "../attribute.js";
import type { CacheAnalysis } from "../cost/cache.js";
import type { CostBreakdown } from "../cost/calculator.js";
import type { Turn } from "../turns.js";
import { PRICING_AS_OF } from "../cost/pricing.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
};

function usd(n: number): string {
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

function tok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return String(n);
}

function duration(session: NormalizedSession): string {
  if (!session.startTime || !session.endTime) return "?";
  const ms = Date.parse(session.endTime) - Date.parse(session.startTime);
  const h = Math.floor(ms / 3.6e6);
  const m = Math.round((ms % 3.6e6) / 6e4);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const RULE = "─".repeat(63);

function bar(fraction: number): string {
  return "█".repeat(Math.max(0, Math.round(fraction * 8)));
}

function hhmm(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? "??:??"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function categoryLines(attr: Attribution, totalUSD: number): string[] {
  const rows: [string, number][] = [
    ["Model generation (output tokens)", attr.generationUSD],
    ["Tool results fed back", attr.toolResultsUSD],
    ["File reads (Read tool)", attr.fileReadsUSD],
    ["System prompt & overhead", attr.overheadUSD],
    ["Cache writes (premium)", attr.cacheWritesUSD],
  ];
  if (attr.compactionUSD > 0) rows.push(["Context compaction", attr.compactionUSD]);
  rows.sort((a, b) => b[1] - a[1]);
  const lines = [`  Where it went`, `  ${RULE}`];
  for (const [label, amount] of rows) {
    const frac = totalUSD > 0 ? amount / totalUSD : 0;
    lines.push(`  ${label.padEnd(38)} ${bar(frac).padEnd(9)}${usd(amount).padStart(8)}`);
  }
  lines.push(`  ${RULE}`);
  return lines;
}

function turnLines(turns: Turn[]): string[] {
  if (turns.length === 0) return [];
  const lines = [``, `  Top ${turns.length} most expensive turns`, `  ${RULE}`];
  for (const t of turns) {
    lines.push(
      `  ${usd(t.costUSD).padStart(7)}  ${hhmm(t.startTime)}  ${t.description} ` +
        c.dim(`(${tok(t.inputGrowthTokens)} in / ${tok(t.outputTokens)} out)`),
    );
  }
  lines.push(`  ${RULE}`);
  return lines;
}

function cacheLines(cache: CacheAnalysis): string[] {
  const lines = [``, `  Cache efficiency`, `  ${RULE}`];
  lines.push(
    `  Cache hit rate: ${(cache.hitRate * 100).toFixed(0)}%  ·  saved ≈ ${usd(cache.savedUSD)} vs. uncached`,
  );
  if (cache.invalidations > 0) {
    lines.push(
      `  Wasted on cache re-writes after prefix breaks: ${usd(cache.wastedUSD)} ` +
        c.dim(`(${cache.invalidations} rebuild${cache.invalidations > 1 ? "s" : ""})`),
    );
  } else {
    lines.push(`  No mid-session cache rebuilds detected`);
  }
  lines.push(`  ${RULE}`);
  return lines;
}

export function renderReport(
  session: NormalizedSession,
  cost: CostBreakdown,
  attr?: Attribution,
  turns?: Turn[],
  cache?: CacheAnalysis,
): string {
  const lines: string[] = [];
  const shortId = session.sessionId.slice(0, 8);
  lines.push("");
  lines.push(
    `  ${c.bold("tokenbill")} - session ${shortId} · ${duration(session)} · ${session.models.join(", ")}`,
  );
  lines.push("");
  lines.push(`  ${c.bold("TOTAL ESTIMATED COST".padEnd(50))}${c.bold(usd(cost.totalUSD))}`);
  lines.push("");
  if (attr) {
    lines.push(...categoryLines(attr, cost.totalUSD));
    for (const e of attr.compactionEvents) {
      lines.push(
        `  Context compacted at ${hhmm(e.timestamp)} - cost ${usd(e.costUSD)}, ` +
          `dropped ~${tok(e.droppedTokens)} tokens of history` +
          (e.subagent ? c.dim(` (sub-agent ${e.subagent})`) : ""),
      );
    }
    if (cache) lines.push(...cacheLines(cache));
    if (turns && turns.length > 0) lines.push(...turnLines(turns));
    lines.push("");
  }
  lines.push(`  Per model (${cost.requestCount} API requests)`);
  lines.push(`  ${RULE}`);
  for (const m of cost.perModel) {
    const flag = m.pricedExactly ? "" : c.yellow(" ~unknown model, sonnet rates");
    lines.push(
      `  ${m.model.padEnd(30)} ${tok(m.input + m.cacheRead + m.cacheWrite).padStart(7)} in ` +
        `${tok(m.output).padStart(7)} out  ${usd(m.costUSD).padStart(8)}${flag}`,
    );
  }
  lines.push(`  ${RULE}`);
  lines.push(
    `  Tokens: ${tok(cost.tokens.input)} uncached in · ${tok(cost.tokens.cacheRead)} cache read · ` +
      `${tok(cost.tokens.cacheWrite)} cache write · ${tok(cost.tokens.output)} out`,
  );
  if (cost.subagentUSD > 0) {
    lines.push(`  Sub-agents: ${usd(cost.subagentUSD)} of the total`);
  }
  const st = cost.serverToolUse;
  if (st.webSearch + st.webFetch > 0) {
    lines.push(
      `  Server tools: ${st.webSearch} web searches, ${st.webFetch} web fetches ${c.dim("(not priced)")}`,
    );
  }
  if (session.skippedLines > 0) {
    lines.push(c.yellow(`  Skipped ${session.skippedLines} malformed log line(s)`));
  }
  for (const w of session.warnings) lines.push(c.yellow(`  warn: ${w}`));
  lines.push("");
  lines.push(
    c.dim(
      `  API-equivalent cost estimate · prices as of ${PRICING_AS_OF} · subscription users pay flat fees`,
    ),
  );
  lines.push("");
  return lines.join("\n");
}

function shortDate(ts: string | undefined): string {
  if (!ts) return "?";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "?" : d.toISOString().slice(0, 10);
}

export function renderAggregateReport(
  result: AggregateResult,
  projectLabel: string,
  topN: number,
): string {
  const lines: string[] = [];
  const oldest = result.sessions.length ? result.sessions[result.sessions.length - 1].startTime : undefined;
  const newest = result.sessions.length ? result.sessions[0].startTime : undefined;

  lines.push("");
  lines.push(`  ${c.bold("tokenbill")} - ${c.dim(projectLabel)}`);
  lines.push(
    `  ${result.sessionCount} session${result.sessionCount === 1 ? "" : "s"}` +
      (oldest && newest ? ` · ${shortDate(oldest)} → ${shortDate(newest)}` : ""),
  );
  lines.push("");
  lines.push(`  ${c.bold("TOTAL ESTIMATED COST".padEnd(50))}${c.bold(usd(result.totalUSD))}`);
  lines.push("");

  const attrLike: Attribution = { ...result.categories, compactionEvents: [] };
  lines.push(...categoryLines(attrLike, result.totalUSD));
  if (result.compactionEventCount > 0) {
    lines.push(
      `  ${result.compactionEventCount} context compaction event(s) across all sessions ` +
        c.dim(`(${usd(result.categories.compactionUSD)} total)`),
    );
  }
  lines.push(...cacheLines(result.cache));

  if (result.topTurns.length > 0) {
    lines.push(``, `  Top ${result.topTurns.length} most expensive turns (all sessions)`, `  ${RULE}`);
    for (const t of result.topTurns) {
      lines.push(
        `  ${usd(t.costUSD).padStart(7)}  ${t.sessionId.slice(0, 8)}  ${hhmm(t.startTime)}  ${t.description} ` +
          c.dim(`(${tok(t.inputGrowthTokens)} in / ${tok(t.outputTokens)} out)`),
      );
    }
    lines.push(`  ${RULE}`);
  }

  lines.push("");
  lines.push(`  Per model`);
  lines.push(`  ${RULE}`);
  for (const m of result.perModel) {
    lines.push(
      `  ${m.model.padEnd(30)} ${tok(m.input + m.cacheRead + m.cacheWrite).padStart(7)} in ` +
        `${tok(m.output).padStart(7)} out  ${usd(m.costUSD).padStart(8)}`,
    );
  }
  lines.push(`  ${RULE}`);

  lines.push("");
  lines.push(`  Sessions (newest first)`);
  lines.push(`  ${RULE}`);
  for (const s of result.sessions) {
    lines.push(
      `  ${usd(s.costUSD).padStart(8)}  ${s.sessionId.slice(0, 8)}  ${shortDate(s.startTime)}  ${s.models.join(", ")}`,
    );
  }
  lines.push(`  ${RULE}`);

  lines.push("");
  lines.push(
    c.dim(
      `  API-equivalent cost estimate · prices as of ${PRICING_AS_OF} · subscription users pay flat fees`,
    ),
  );
  lines.push("");
  return lines.join("\n");
}
