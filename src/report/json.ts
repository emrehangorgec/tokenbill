import type { NormalizedSession } from "../adapters/types.js";
import type { AggregateResult } from "../aggregate.js";
import type { Attribution } from "../attribute.js";
import type { CacheAnalysis } from "../cost/cache.js";
import type { CostBreakdown } from "../cost/calculator.js";
import type { Turn } from "../turns.js";
import { advise, type Advice } from "../advise.js";
import { PRICING_AS_OF } from "../cost/pricing.js";
import { dailyTrend } from "../trends.js";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function recommendationsJson(advice: Advice) {
  return {
    findings: advice.findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      savingsUSD: f.savingsUSD === undefined ? undefined : round(f.savingsUSD),
    })),
    potentialSavingsUSD: round(advice.potentialSavingsUSD),
  };
}

export function renderJson(
  session: NormalizedSession,
  cost: CostBreakdown,
  attr: Attribution,
  turns: Turn[],
  cache: CacheAnalysis,
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      pricingAsOf: PRICING_AS_OF,
      session: {
        id: session.sessionId,
        source: session.sourcePath,
        models: session.models,
        startTime: session.startTime,
        endTime: session.endTime,
        requestCount: cost.requestCount,
        skippedLines: session.skippedLines,
        warnings: session.warnings,
      },
      totalUSD: round(cost.totalUSD),
      tokens: cost.tokens,
      categories: {
        generationUSD: round(attr.generationUSD),
        toolResultsUSD: round(attr.toolResultsUSD),
        fileReadsUSD: round(attr.fileReadsUSD),
        overheadUSD: round(attr.overheadUSD),
        cacheWritesUSD: round(attr.cacheWritesUSD),
        compactionUSD: round(attr.compactionUSD),
      },
      compactionEvents: attr.compactionEvents.map((e) => ({
        timestamp: e.timestamp,
        costUSD: round(e.costUSD),
        droppedTokens: Math.round(e.droppedTokens),
        subagent: e.subagent,
      })),
      cache: {
        hitRate: round(cache.hitRate),
        savedUSD: round(cache.savedUSD),
        wastedUSD: round(cache.wastedUSD),
        invalidations: cache.invalidations,
      },
      recommendations: recommendationsJson(
        advise({
          totalUSD: cost.totalUSD,
          categories: attr,
          cache,
          compactionEventCount: attr.compactionEvents.length,
        }),
      ),
      perModel: cost.perModel.map((m) => ({ ...m, costUSD: round(m.costUSD) })),
      serverToolUse: cost.serverToolUse,
      subagentUSD: round(cost.subagentUSD),
      topTurns: turns.map((t) => ({
        startTime: t.startTime,
        costUSD: round(t.costUSD),
        description: t.description,
        outputTokens: t.outputTokens,
        inputGrowthTokens: Math.round(t.inputGrowthTokens),
        hasCompaction: t.hasCompaction,
        subagents: [...t.subagents],
      })),
    },
    null,
    2,
  );
}

export function renderAggregateJson(result: AggregateResult, projectLabel: string): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      mode: "aggregate",
      pricingAsOf: PRICING_AS_OF,
      projectLabel,
      sessionCount: result.sessionCount,
      totalUSD: round(result.totalUSD),
      requestCount: result.requestCount,
      categories: {
        generationUSD: round(result.categories.generationUSD),
        toolResultsUSD: round(result.categories.toolResultsUSD),
        fileReadsUSD: round(result.categories.fileReadsUSD),
        overheadUSD: round(result.categories.overheadUSD),
        cacheWritesUSD: round(result.categories.cacheWritesUSD),
        compactionUSD: round(result.categories.compactionUSD),
      },
      compactionEventCount: result.compactionEventCount,
      cache: {
        hitRate: round(result.cache.hitRate),
        savedUSD: round(result.cache.savedUSD),
        wastedUSD: round(result.cache.wastedUSD),
        invalidations: result.cache.invalidations,
      },
      recommendations: recommendationsJson(
        advise({
          totalUSD: result.totalUSD,
          categories: result.categories,
          cache: result.cache,
          compactionEventCount: result.compactionEventCount,
        }),
      ),
      dailyTrend: dailyTrend(result.sessions).map((b) => ({ ...b, costUSD: round(b.costUSD) })),
      perModel: result.perModel.map((m) => ({ ...m, costUSD: round(m.costUSD) })),
      sessions: result.sessions.map((s) => ({ ...s, costUSD: round(s.costUSD) })),
      topTurns: result.topTurns.map((t) => ({
        sessionId: t.sessionId,
        startTime: t.startTime,
        costUSD: round(t.costUSD),
        description: t.description,
        outputTokens: t.outputTokens,
        inputGrowthTokens: Math.round(t.inputGrowthTokens),
        hasCompaction: t.hasCompaction,
      })),
    },
    null,
    2,
  );
}
