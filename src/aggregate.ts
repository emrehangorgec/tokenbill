/** Combine multiple sessions (e.g. every session in a project) into one summary. */
import type { NormalizedSession } from "./adapters/types.js";
import { attribute } from "./attribute.js";
import { analyzeCache, type CacheAnalysis } from "./cost/cache.js";
import { calculate, type ModelBreakdown } from "./cost/calculator.js";
import { segmentTurns, type Turn } from "./turns.js";

export interface SessionSummary {
  sessionId: string;
  sourcePath: string;
  models: string[];
  startTime?: string;
  endTime?: string;
  costUSD: number;
  requestCount: number;
}

export interface AggregateTurn extends Turn {
  sessionId: string;
}

export interface AggregateCategories {
  generationUSD: number;
  toolResultsUSD: number;
  fileReadsUSD: number;
  overheadUSD: number;
  cacheWritesUSD: number;
  compactionUSD: number;
}

export interface AggregateResult {
  sessionCount: number;
  sessions: SessionSummary[];
  totalUSD: number;
  requestCount: number;
  categories: AggregateCategories;
  compactionEventCount: number;
  cache: CacheAnalysis;
  perModel: ModelBreakdown[];
  topTurns: AggregateTurn[];
}

export function aggregate(sessions: NormalizedSession[], topN = 10): AggregateResult {
  const sessionSummaries: SessionSummary[] = [];
  const categories: AggregateCategories = {
    generationUSD: 0,
    toolResultsUSD: 0,
    fileReadsUSD: 0,
    overheadUSD: 0,
    cacheWritesUSD: 0,
    compactionUSD: 0,
  };
  let totalUSD = 0;
  let requestCount = 0;
  let compactionEventCount = 0;
  let cacheRead = 0,
    cacheWrite = 0,
    cacheUncached = 0,
    cacheSaved = 0,
    cacheWasted = 0,
    cacheInvalidations = 0;
  const modelMap = new Map<string, ModelBreakdown>();
  const allTurns: AggregateTurn[] = [];

  for (const session of sessions) {
    const cost = calculate(session);
    const attr = attribute(session);
    const cache = analyzeCache(session);

    sessionSummaries.push({
      sessionId: session.sessionId,
      sourcePath: session.sourcePath,
      models: session.models,
      startTime: session.startTime,
      endTime: session.endTime,
      costUSD: cost.totalUSD,
      requestCount: cost.requestCount,
    });

    totalUSD += cost.totalUSD;
    requestCount += cost.requestCount;
    categories.generationUSD += attr.generationUSD;
    categories.toolResultsUSD += attr.toolResultsUSD;
    categories.fileReadsUSD += attr.fileReadsUSD;
    categories.overheadUSD += attr.overheadUSD;
    categories.cacheWritesUSD += attr.cacheWritesUSD;
    categories.compactionUSD += attr.compactionUSD;
    compactionEventCount += attr.compactionEvents.length;

    cacheRead += cache.tokens.read;
    cacheWrite += cache.tokens.write;
    cacheUncached += cache.tokens.uncached;
    cacheSaved += cache.savedUSD;
    cacheWasted += cache.wastedUSD;
    cacheInvalidations += cache.invalidations;

    for (const m of cost.perModel) {
      let acc = modelMap.get(m.model);
      if (!acc) {
        acc = { ...m, requests: 0, costUSD: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        modelMap.set(m.model, acc);
      }
      acc.requests += m.requests;
      acc.costUSD += m.costUSD;
      acc.input += m.input;
      acc.output += m.output;
      acc.cacheRead += m.cacheRead;
      acc.cacheWrite += m.cacheWrite;
    }

    for (const t of segmentTurns(session)) {
      if (t.costUSD > 0) allTurns.push({ ...t, sessionId: session.sessionId });
    }
  }

  const denom = cacheRead + cacheWrite + cacheUncached;
  const cache: CacheAnalysis = {
    hitRate: denom > 0 ? cacheRead / denom : 0,
    savedUSD: cacheSaved,
    wastedUSD: cacheWasted,
    invalidations: cacheInvalidations,
    tokens: { read: cacheRead, write: cacheWrite, uncached: cacheUncached },
  };

  sessionSummaries.sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));
  allTurns.sort((a, b) => b.costUSD - a.costUSD);

  return {
    sessionCount: sessions.length,
    sessions: sessionSummaries,
    totalUSD,
    requestCount,
    categories,
    compactionEventCount,
    cache,
    perModel: [...modelMap.values()].sort((a, b) => b.costUSD - a.costUSD),
    topTurns: allTurns.slice(0, topN),
  };
}
