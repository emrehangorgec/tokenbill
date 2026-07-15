import type { NormalizedSession } from "../adapters/types.js";
import type { AggregateResult, AggregateTurn } from "../aggregate.js";
import type { Attribution } from "../attribute.js";
import type { CacheAnalysis } from "../cost/cache.js";
import type { CostBreakdown } from "../cost/calculator.js";
import type { Turn } from "../turns.js";
import { PRICING_AS_OF } from "../cost/pricing.js";
import { bold, dim, paint, palette } from "./theme.js";

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

const RULE = "─".repeat(66);
const BAR_WIDTH = 24;

/** Two-tone bar: colored fill + dim track. Pads to BAR_WIDTH visible chars. */
function bar(fraction: number, color: number): string {
  const fill = Math.max(0, Math.min(BAR_WIDTH, Math.round(fraction * BAR_WIDTH)));
  return paint(color, "█".repeat(fill)) + dim("░".repeat(BAR_WIDTH - fill));
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`.padStart(4);
}

function hhmm(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? "??:??"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function categoryLines(attr: Attribution, totalUSD: number): string[] {
  const rows: [string, number, number][] = [
    ["Model generation (output tokens)", attr.generationUSD, palette.generation],
    ["Tool results fed back", attr.toolResultsUSD, palette.toolResults],
    ["File reads (Read tool)", attr.fileReadsUSD, palette.fileReads],
    ["System prompt & overhead", attr.overheadUSD, palette.overhead],
    ["Cache writes (premium)", attr.cacheWritesUSD, palette.cacheWrites],
  ];
  if (attr.compactionUSD > 0) rows.push(["Context compaction", attr.compactionUSD, palette.compaction]);
  rows.sort((a, b) => b[1] - a[1]);
  const lines = [`  ${bold("Where it went")}`, dim(`  ${RULE}`)];
  for (const [label, amount, color] of rows) {
    const frac = totalUSD > 0 ? amount / totalUSD : 0;
    lines.push(
      `  ${paint(color, label.padEnd(34))} ${bar(frac, color)} ${pct(frac)}${usd(amount).padStart(9)}`,
    );
  }
  lines.push(dim(`  ${RULE}`));
  return lines;
}

function turnLines(turns: Turn[], sessionIdOf?: (t: Turn) => string): string[] {
  if (turns.length === 0) return [];
  const title = sessionIdOf
    ? `Top ${turns.length} most expensive turns (all sessions)`
    : `Top ${turns.length} most expensive turns`;
  const lines = [``, `  ${bold(title)}`, dim(`  ${RULE}`)];
  for (const t of turns) {
    const sid = sessionIdOf ? dim(`${sessionIdOf(t)}  `) : "";
    lines.push(
      `  ${bold(usd(t.costUSD).padStart(7))}  ${sid}${hhmm(t.startTime)}  ${t.description} ` +
        dim(`(${tok(t.inputGrowthTokens)} in / ${tok(t.outputTokens)} out)`),
    );
  }
  lines.push(dim(`  ${RULE}`));
  return lines;
}

function cacheLines(cache: CacheAnalysis): string[] {
  const lines = [``, `  ${bold("Cache efficiency")}`, dim(`  ${RULE}`)];
  const rate = cache.hitRate;
  const rateColor = rate >= 0.8 ? palette.good : rate >= 0.5 ? palette.warn : palette.bad;
  lines.push(
    `  Cache hit rate: ${paint(rateColor, `${(rate * 100).toFixed(0)}%`)}  ·  saved ≈ ${paint(
      palette.good,
      usd(cache.savedUSD),
    )} vs. uncached`,
  );
  if (cache.invalidations > 0) {
    lines.push(
      `  Wasted on cache re-writes after prefix breaks: ${paint(palette.bad, usd(cache.wastedUSD))} ` +
        dim(`(${cache.invalidations} rebuild${cache.invalidations > 1 ? "s" : ""})`),
    );
  } else {
    lines.push(`  No mid-session cache rebuilds detected`);
  }
  lines.push(dim(`  ${RULE}`));
  return lines;
}

function totalLines(totalUSD: number): string[] {
  return [
    `  ${bold("TOTAL ESTIMATED COST".padEnd(50))}${bold(paint(palette.brand, usd(totalUSD)))}`,
  ];
}

function footer(): string {
  return dim(
    `  API-equivalent cost estimate · prices as of ${PRICING_AS_OF} · subscription users pay flat fees`,
  );
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
    `  ${bold(paint(palette.brand, "tokenbill"))} ${dim(`- session ${shortId} · ${duration(session)} · ${session.models.join(", ")}`)}`,
  );
  lines.push("");
  lines.push(...totalLines(cost.totalUSD));
  lines.push("");
  if (attr) {
    lines.push(...categoryLines(attr, cost.totalUSD));
    for (const e of attr.compactionEvents) {
      lines.push(
        `  Context compacted at ${hhmm(e.timestamp)} - cost ${usd(e.costUSD)}, ` +
          `dropped ~${tok(e.droppedTokens)} tokens of history` +
          (e.subagent ? dim(` (sub-agent ${e.subagent})`) : ""),
      );
    }
    if (cache) lines.push(...cacheLines(cache));
    if (turns && turns.length > 0) lines.push(...turnLines(turns));
    lines.push("");
  }
  lines.push(`  ${bold(`Per model`)} ${dim(`(${cost.requestCount} API requests)`)}`);
  lines.push(dim(`  ${RULE}`));
  for (const m of cost.perModel) {
    const flag = m.pricedExactly ? "" : paint(palette.warn, " ~unknown model, sonnet rates");
    lines.push(
      `  ${m.model.padEnd(30)} ${tok(m.input + m.cacheRead + m.cacheWrite).padStart(7)} in ` +
        `${tok(m.output).padStart(7)} out  ${usd(m.costUSD).padStart(8)}${flag}`,
    );
  }
  lines.push(dim(`  ${RULE}`));
  lines.push(
    dim(
      `  Tokens: ${tok(cost.tokens.input)} uncached in · ${tok(cost.tokens.cacheRead)} cache read · ` +
        `${tok(cost.tokens.cacheWrite)} cache write · ${tok(cost.tokens.output)} out`,
    ),
  );
  if (cost.subagentUSD > 0) {
    lines.push(`  Sub-agents: ${usd(cost.subagentUSD)} of the total`);
  }
  const st = cost.serverToolUse;
  if (st.webSearch + st.webFetch > 0) {
    lines.push(
      `  Server tools: ${st.webSearch} web searches, ${st.webFetch} web fetches ${dim("(not priced)")}`,
    );
  }
  if (session.skippedLines > 0) {
    lines.push(paint(palette.warn, `  Skipped ${session.skippedLines} malformed log line(s)`));
  }
  for (const w of session.warnings) lines.push(paint(palette.warn, `  warn: ${w}`));
  lines.push("");
  lines.push(footer());
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
  lines.push(`  ${bold(paint(palette.brand, "tokenbill"))} ${dim(`- ${projectLabel}`)}`);
  lines.push(
    dim(
      `  ${result.sessionCount} session${result.sessionCount === 1 ? "" : "s"}` +
        (oldest && newest ? ` · ${shortDate(oldest)} → ${shortDate(newest)}` : ""),
    ),
  );
  lines.push("");
  lines.push(...totalLines(result.totalUSD));
  lines.push("");

  const attrLike: Attribution = { ...result.categories, compactionEvents: [] };
  lines.push(...categoryLines(attrLike, result.totalUSD));
  if (result.compactionEventCount > 0) {
    lines.push(
      `  ${result.compactionEventCount} context compaction event(s) across all sessions ` +
        dim(`(${usd(result.categories.compactionUSD)} total)`),
    );
  }
  lines.push(...cacheLines(result.cache));

  lines.push(...turnLines(result.topTurns, (t) => (t as AggregateTurn).sessionId.slice(0, 8)));

  lines.push("");
  lines.push(`  ${bold("Per model")}`);
  lines.push(dim(`  ${RULE}`));
  for (const m of result.perModel) {
    lines.push(
      `  ${m.model.padEnd(30)} ${tok(m.input + m.cacheRead + m.cacheWrite).padStart(7)} in ` +
        `${tok(m.output).padStart(7)} out  ${usd(m.costUSD).padStart(8)}`,
    );
  }
  lines.push(dim(`  ${RULE}`));

  lines.push("");
  lines.push(`  ${bold("Sessions (newest first)")}`);
  lines.push(dim(`  ${RULE}`));
  const maxCost = Math.max(...result.sessions.map((s) => s.costUSD), 0);
  for (const s of result.sessions) {
    const frac = maxCost > 0 ? s.costUSD / maxCost : 0;
    const miniBar = dim("▪".repeat(Math.max(frac > 0 ? 1 : 0, Math.round(frac * 10))).padEnd(10));
    lines.push(
      `  ${usd(s.costUSD).padStart(8)}  ${miniBar}  ${dim(s.sessionId.slice(0, 8))}  ${shortDate(s.startTime)}  ${dim(s.models.join(", "))}`,
    );
  }
  lines.push(dim(`  ${RULE}`));

  lines.push("");
  lines.push(footer());
  lines.push("");
  return lines.join("\n");
}
