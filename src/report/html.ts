/**
 * Single-file HTML report: inline CSS + a tiny inline sort script, no external
 * requests, dark theme matching the terminal palette. The output is meant to
 * be opened locally or shared as one self-contained file.
 */
import type { NormalizedSession } from "../adapters/types.js";
import type { AggregateResult } from "../aggregate.js";
import type { Attribution } from "../attribute.js";
import type { CacheAnalysis } from "../cost/cache.js";
import type { CostBreakdown, ModelBreakdown } from "../cost/calculator.js";
import type { Turn } from "../turns.js";
import { advise, type Advice } from "../advise.js";
import { PRICING_AS_OF } from "../cost/pricing.js";
import { dailyTrend, type DayBucket } from "../trends.js";

const C = {
  bg: "#0d1117",
  panel: "#161b22",
  border: "#21262d",
  fg: "#d4d4d4",
  dim: "#6e7681",
  brand: "#00d7ff",
  generation: "#d75fd7",
  toolResults: "#5fafff",
  fileReads: "#5fd7d7",
  overhead: "#8a8a8a",
  cacheWrites: "#d7af5f",
  compaction: "#ff5f5f",
  good: "#5fd787",
  warn: "#ffaf00",
  bad: "#ff5f5f",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function usd(n: number): string {
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

function tok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return String(n);
}

function hhmm(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? "??:??"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function shortDate(ts: string | undefined): string {
  if (!ts) return "?";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "?" : d.toISOString().slice(0, 10);
}

function section(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

interface CategoryLike {
  generationUSD: number;
  toolResultsUSD: number;
  fileReadsUSD: number;
  overheadUSD: number;
  cacheWritesUSD: number;
  compactionUSD: number;
}

function categorySection(cat: CategoryLike, totalUSD: number): string {
  const rows: [string, number, string][] = [
    ["Model generation (output tokens)", cat.generationUSD, C.generation],
    ["Tool results fed back", cat.toolResultsUSD, C.toolResults],
    ["File reads (Read tool)", cat.fileReadsUSD, C.fileReads],
    ["System prompt & overhead", cat.overheadUSD, C.overhead],
    ["Cache writes (premium)", cat.cacheWritesUSD, C.cacheWrites],
  ];
  if (cat.compactionUSD > 0) rows.push(["Context compaction", cat.compactionUSD, C.compaction]);
  rows.sort((a, b) => b[1] - a[1]);
  const body = rows
    .map(([label, amount, color]) => {
      const p = totalUSD > 0 ? (amount / totalUSD) * 100 : 0;
      return (
        `<div class="catrow">` +
        `<span class="catlabel" style="color:${color}">${esc(label)}</span>` +
        `<span class="cattrack"><span class="catfill" style="width:${p.toFixed(1)}%;background:${color}"></span></span>` +
        `<span class="catpct">${p.toFixed(0)}%</span>` +
        `<span class="catusd">${usd(amount)}</span></div>`
      );
    })
    .join("");
  return section("Where it went", body);
}

function cacheSection(cache: CacheAnalysis): string {
  const rate = cache.hitRate;
  const rateColor = rate >= 0.8 ? C.good : rate >= 0.5 ? C.warn : C.bad;
  let body =
    `<p>Cache hit rate: <b style="color:${rateColor}">${(rate * 100).toFixed(0)}%</b>` +
    ` &middot; saved &asymp; <b style="color:${C.good}">${usd(cache.savedUSD)}</b> vs. uncached</p>`;
  if (cache.invalidations > 0) {
    body += `<p>Wasted on cache re-writes after prefix breaks: <b style="color:${C.bad}">${usd(cache.wastedUSD)}</b> <span class="dim">(${cache.invalidations} rebuild${cache.invalidations > 1 ? "s" : ""})</span></p>`;
  } else {
    body += `<p>No mid-session cache rebuilds detected</p>`;
  }
  return section("Cache efficiency", body);
}

function adviceSection(advice: Advice): string {
  if (advice.findings.length === 0) return "";
  let body = advice.findings
    .map((f) => {
      const mark =
        f.severity === "warn"
          ? `<span style="color:${C.warn}">&#9888;</span>`
          : `<span style="color:${C.good}">&#10003;</span>`;
      const detail = f.detail ? `<div class="dim finddetail">&rarr; ${esc(f.detail)}</div>` : "";
      return `<div class="finding">${mark} ${esc(f.title)}${detail}</div>`;
    })
    .join("");
  if (advice.potentialSavingsUSD >= 0.05) {
    body += `<p class="dim">Potential savings this project: &asymp; ${usd(advice.potentialSavingsUSD)}</p>`;
  }
  return section("Recommendations", body);
}

function trendSection(buckets: DayBucket[]): string {
  const activeDays = buckets.filter((b) => b.sessions > 0).length;
  if (activeDays < 2) return "";
  const max = Math.max(...buckets.map((b) => b.costUSD));
  if (max <= 0) return "";
  const total = buckets.reduce((s, b) => s + b.costUSD, 0);
  const cols = buckets
    .map((b) => {
      const h = Math.max(b.costUSD > 0 ? 4 : 2, Math.round((b.costUSD / max) * 120));
      const label = b.date.slice(5);
      const active = b.sessions > 0;
      return (
        `<div class="daycol" title="${esc(b.date)}: ${usd(b.costUSD)} (${b.sessions} session${b.sessions === 1 ? "" : "s"})">` +
        `<span class="dayusd">${active ? usd(b.costUSD) : ""}</span>` +
        `<span class="daybar" style="height:${h}px;background:${active ? C.brand : C.border}"></span>` +
        `<span class="daylabel">${esc(label)}</span></div>`
      );
    })
    .join("");
  return section(
    `Daily spend (last ${buckets.length} days)`,
    `<div class="trend">${cols}</div><p class="dim">total ${usd(total)}</p>`,
  );
}

function table(headers: [string, "num" | "str"][], rows: string[][], sortable: boolean): string {
  const ths = headers
    .map(([h, kind], i) =>
      sortable
        ? `<th data-kind="${kind}" onclick="st(this,${i})">${esc(h)}</th>`
        : `<th>${esc(h)}</th>`,
    )
    .join("");
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table${sortable ? ` class="sortable"` : ""}><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function turnsSection(turns: (Turn & { sessionId?: string })[], aggregate: boolean): string {
  if (turns.length === 0) return "";
  const headers: [string, "num" | "str"][] = aggregate
    ? [["Cost", "num"], ["Session", "str"], ["Time", "str"], ["What happened", "str"], ["In", "num"], ["Out", "num"]]
    : [["Cost", "num"], ["Time", "str"], ["What happened", "str"], ["In", "num"], ["Out", "num"]];
  const rows = turns.map((t) => {
    const cells = [
      `<b data-v="${t.costUSD}">${usd(t.costUSD)}</b>`,
      ...(aggregate ? [`<span class="dim">${esc((t.sessionId ?? "").slice(0, 8))}</span>`] : []),
      hhmm(t.startTime),
      esc(t.description),
      `<span class="dim" data-v="${Math.round(t.inputGrowthTokens)}">${tok(t.inputGrowthTokens)}</span>`,
      `<span class="dim" data-v="${t.outputTokens}">${tok(t.outputTokens)}</span>`,
    ];
    return cells;
  });
  const title = aggregate
    ? `Top ${turns.length} most expensive turns (all sessions)`
    : `Top ${turns.length} most expensive turns`;
  return section(title, table(headers, rows, true));
}

function modelSection(perModel: ModelBreakdown[]): string {
  const rows = perModel.map((m) => [
    esc(m.model),
    `<span data-v="${m.input + m.cacheRead + m.cacheWrite}">${tok(m.input + m.cacheRead + m.cacheWrite)}</span>`,
    `<span data-v="${m.output}">${tok(m.output)}</span>`,
    `<b data-v="${m.costUSD}">${usd(m.costUSD)}</b>`,
  ]);
  return section(
    "Per model",
    table([["Model", "str"], ["In", "num"], ["Out", "num"], ["Cost", "num"]], rows, false),
  );
}

function page(subtitle: string, totalUSD: number, sections: string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tokenbill report</title>
<style>
  body{margin:0;background:${C.bg};color:${C.fg};font:14px/1.5 'Cascadia Code','SF Mono',Consolas,Menlo,monospace}
  main{max-width:900px;margin:0 auto;padding:32px 20px 48px}
  h1{font-size:20px;margin:0}
  h1 .brand{color:${C.brand}}
  h2{font-size:14px;margin:0 0 10px;color:${C.fg}}
  .dim{color:${C.dim}}
  .total{font-size:34px;font-weight:bold;color:${C.brand};margin:14px 0 4px}
  section{background:${C.panel};border:1px solid ${C.border};border-radius:8px;padding:16px 18px;margin-top:16px}
  .catrow{display:flex;align-items:center;gap:10px;margin:5px 0}
  .catlabel{flex:0 0 260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cattrack{flex:1;height:12px;background:${C.border};border-radius:6px;overflow:hidden}
  .catfill{display:block;height:100%}
  .catpct{flex:0 0 42px;text-align:right;color:${C.dim}}
  .catusd{flex:0 0 76px;text-align:right}
  p{margin:6px 0}
  .finding{margin:6px 0}
  .finddetail{margin-left:22px}
  .trend{display:flex;align-items:flex-end;gap:6px;padding-top:8px}
  .daycol{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0}
  .daybar{width:100%;max-width:42px;border-radius:3px 3px 0 0}
  .daylabel{font-size:11px;color:${C.dim}}
  .dayusd{font-size:11px;min-height:16px}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th,td{text-align:left;padding:5px 10px 5px 0;border-bottom:1px solid ${C.border};vertical-align:top}
  th{color:${C.dim};font-weight:normal}
  .sortable th{cursor:pointer;user-select:none}
  .sortable th:hover{color:${C.fg}}
  footer{margin-top:20px;color:${C.dim};font-size:12px}
  @media (max-width:640px){.catlabel{flex-basis:140px}}
</style>
</head>
<body>
<main>
<h1><span class="brand">tokenbill</span> <span class="dim">${esc(subtitle)}</span></h1>
<div class="total">${usd(totalUSD)}</div>
<div class="dim">TOTAL ESTIMATED COST</div>
${sections.filter(Boolean).join("\n")}
<footer>API-equivalent cost estimate &middot; prices as of ${esc(PRICING_AS_OF)} &middot; subscription users pay flat fees</footer>
</main>
<script>
function st(th,i){
  var t=th.closest('table'),tb=t.tBodies[0],rows=[].slice.call(tb.rows);
  var num=th.dataset.kind==='num';
  var dir=th.dataset.dir==='asc'?'desc':'asc';
  [].forEach.call(t.tHead.rows[0].cells,function(c){delete c.dataset.dir});
  th.dataset.dir=dir;
  rows.sort(function(a,b){
    var av=cell(a,i,num),bv=cell(b,i,num);
    var r=num?av-bv:String(av).localeCompare(String(bv));
    return dir==='asc'?r:-r;
  });
  rows.forEach(function(r){tb.appendChild(r)});
}
function cell(row,i,num){
  var td=row.cells[i],el=td.querySelector('[data-v]');
  if(num) return parseFloat(el?el.dataset.v:td.textContent.replace(/[^0-9.\\-]/g,''))||0;
  return td.textContent.trim();
}
</script>
</body>
</html>
`;
}

function duration(session: NormalizedSession): string {
  if (!session.startTime || !session.endTime) return "?";
  const ms = Date.parse(session.endTime) - Date.parse(session.startTime);
  const h = Math.floor(ms / 3.6e6);
  const m = Math.round((ms % 3.6e6) / 6e4);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function renderHtml(
  session: NormalizedSession,
  cost: CostBreakdown,
  attr: Attribution,
  turns: Turn[],
  cache: CacheAnalysis,
): string {
  const subtitle = `session ${session.sessionId.slice(0, 8)} · ${duration(session)} · ${session.models.join(", ")}`;
  const advice = advise({
    totalUSD: cost.totalUSD,
    categories: attr,
    cache,
    compactionEventCount: attr.compactionEvents.length,
  });
  return page(subtitle, cost.totalUSD, [
    categorySection(attr, cost.totalUSD),
    cacheSection(cache),
    adviceSection(advice),
    turnsSection(turns, false),
    modelSection(cost.perModel),
  ]);
}

export function renderAggregateHtml(result: AggregateResult, projectLabel: string): string {
  const oldest = result.sessions.length
    ? result.sessions[result.sessions.length - 1].startTime
    : undefined;
  const newest = result.sessions.length ? result.sessions[0].startTime : undefined;
  const subtitle =
    `${projectLabel} · ${result.sessionCount} session${result.sessionCount === 1 ? "" : "s"}` +
    (oldest && newest ? ` · ${shortDate(oldest)} → ${shortDate(newest)}` : "");
  const advice = advise({
    totalUSD: result.totalUSD,
    categories: result.categories,
    cache: result.cache,
    compactionEventCount: result.compactionEventCount,
  });
  const maxCost = Math.max(...result.sessions.map((s) => s.costUSD), 0);
  const sessionRows = result.sessions.map((s) => {
    const p = maxCost > 0 ? (s.costUSD / maxCost) * 100 : 0;
    return [
      `<b data-v="${s.costUSD}">${usd(s.costUSD)}</b>`,
      `<span class="cattrack" style="display:inline-block;width:80px"><span class="catfill" style="width:${p.toFixed(0)}%;background:${C.dim}"></span></span>`,
      `<span class="dim">${esc(s.sessionId.slice(0, 8))}</span>`,
      shortDate(s.startTime),
      `<span class="dim">${esc(s.models.join(", "))}</span>`,
    ];
  });
  return page(subtitle, result.totalUSD, [
    categorySection(result.categories, result.totalUSD),
    cacheSection(result.cache),
    adviceSection(advice),
    trendSection(dailyTrend(result.sessions)),
    turnsSection(result.topTurns, true),
    modelSection(result.perModel),
    section(
      "Sessions (newest first)",
      table(
        [["Cost", "num"], ["", "str"], ["Session", "str"], ["Date", "str"], ["Models", "str"]],
        sessionRows,
        false,
      ),
    ),
  ]);
}
