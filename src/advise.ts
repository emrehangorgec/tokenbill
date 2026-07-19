/**
 * Waste advisor: turns the already-computed analysis into actionable,
 * dollar-quantified recommendations. Pure heuristics over Attribution and
 * CacheAnalysis - no new parsing, no new cost model.
 */
import type { Categories } from "./attribute.js";
import type { CacheAnalysis } from "./cost/cache.js";

export interface Finding {
  severity: "warn" | "ok";
  /** one line, includes the dollar impact where applicable */
  title: string;
  /** optional follow-up line rendered indented with a leading arrow */
  detail?: string;
  /** contribution to the "potential savings" total */
  savingsUSD?: number;
}

export interface Advice {
  findings: Finding[];
  potentialSavingsUSD: number;
}

export interface AdviseInput {
  totalUSD: number;
  categories: Categories;
  cache: CacheAnalysis;
  compactionEventCount: number;
}

const FILE_READ_SHARE_THRESHOLD = 0.3;
const COMPACTION_SHARE_THRESHOLD = 0.1;
const LOW_HIT_RATE = 0.5;
const HEALTHY_HIT_RATE = 0.8;
const MIN_MATERIAL_USD = 0.05;

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function advise(input: AdviseInput): Advice {
  const { totalUSD, categories, cache, compactionEventCount } = input;
  const findings: Finding[] = [];

  if (cache.invalidations > 0 && cache.wastedUSD >= MIN_MATERIAL_USD) {
    const n = cache.invalidations;
    findings.push({
      severity: "warn",
      title: `${n} cache prefix break${n > 1 ? "s" : ""} cost you ≈ ${usd(cache.wastedUSD)}`,
      detail:
        "usually mid-session config or system prompt changes; keep the prompt prefix stable",
      savingsUSD: cache.wastedUSD,
    });
  }

  const fileReadShare = totalUSD > 0 ? categories.fileReadsUSD / totalUSD : 0;
  if (fileReadShare >= FILE_READ_SHARE_THRESHOLD && categories.fileReadsUSD >= MIN_MATERIAL_USD) {
    const upTo = categories.fileReadsUSD * 0.25;
    findings.push({
      severity: "warn",
      title: `${Math.round(fileReadShare * 100)}% of spend is file reads (≈ ${usd(categories.fileReadsUSD)})`,
      detail: "prefer targeted reads (offset/limit, grep) over re-reading whole files",
      savingsUSD: upTo,
    });
  }

  const compactionShare = totalUSD > 0 ? categories.compactionUSD / totalUSD : 0;
  if (compactionShare >= COMPACTION_SHARE_THRESHOLD && categories.compactionUSD >= MIN_MATERIAL_USD) {
    const n = compactionEventCount;
    findings.push({
      severity: "warn",
      title: `context compaction cost ≈ ${usd(categories.compactionUSD)} (${n} event${n === 1 ? "" : "s"})`,
      detail: "long sessions pay to re-summarize their own history; start fresh sessions per task",
      savingsUSD: categories.compactionUSD,
    });
  }

  const inputTokens = cache.tokens.read + cache.tokens.write + cache.tokens.uncached;
  if (cache.hitRate < LOW_HIT_RATE && inputTokens > 0 && totalUSD >= MIN_MATERIAL_USD) {
    findings.push({
      severity: "warn",
      title: `cache hit rate is only ${Math.round(cache.hitRate * 100)}%`,
      detail: "many short one-shot sessions re-pay the system prompt; batch related work together",
    });
  } else if (cache.hitRate >= HEALTHY_HIT_RATE && inputTokens > 0) {
    findings.push({
      severity: "ok",
      title: `cache hit rate ${Math.round(cache.hitRate * 100)}% - healthy`,
    });
  }

  const potentialSavingsUSD = findings.reduce((s, f) => s + (f.savingsUSD ?? 0), 0);
  return { findings, potentialSavingsUSD };
}
