/**
 * Cache efficiency analysis.
 *  - hit rate  = cacheRead / (cacheRead + cacheWrite + uncached input)
 *  - saved     = what cached tokens would have cost uncached, minus what they cost
 *  - wasted    = the write *premium* paid on mid-session cache rebuilds
 *    (heuristic: a non-first request whose cache_creation exceeds its
 *    cache_read is a cold rebuild - the signature of a prefix invalidation).
 */
import type { NormalizedSession } from "../adapters/types.js";
import { lookupPrice } from "./pricing.js";

export interface CacheAnalysis {
  hitRate: number; // 0..1
  savedUSD: number;
  wastedUSD: number;
  invalidations: number;
  /** raw token totals - exposed so multi-session aggregation can recompute a weighted hitRate */
  tokens: { read: number; write: number; uncached: number };
}

export function analyzeCache(session: NormalizedSession): CacheAnalysis {
  let read = 0;
  let write = 0;
  let uncached = 0;
  let savedUSD = 0;
  let wastedUSD = 0;
  let invalidations = 0;

  for (const stream of session.streams) {
    let first = true;
    for (const ev of stream.events) {
      if (ev.kind !== "request") continue;
      const u = ev.request.usage;
      const { price } = lookupPrice(ev.request.model);
      const rateIn = price.inputPerMTok / 1e6;

      read += u.cache_read_input_tokens;
      write += u.cache_creation_input_tokens;
      uncached += u.input_tokens;
      savedUSD += u.cache_read_input_tokens * rateIn * (1 - price.cacheReadMult);

      if (!first && u.cache_creation_input_tokens > u.cache_read_input_tokens) {
        invalidations++;
        const split = u.cache_creation;
        const w5m = split ? split.ephemeral_5m_input_tokens : u.cache_creation_input_tokens;
        const w1h = split ? split.ephemeral_1h_input_tokens : 0;
        // Only the premium over plain input pricing is "wasted".
        wastedUSD +=
          w5m * rateIn * (price.cacheWrite5mMult - 1) + w1h * rateIn * (price.cacheWrite1hMult - 1);
      }
      first = false;
    }
  }

  const denom = read + write + uncached;
  return {
    hitRate: denom > 0 ? read / denom : 0,
    savedUSD,
    wastedUSD,
    invalidations,
    tokens: { read, write, uncached },
  };
}
