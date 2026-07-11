/**
 * Category attribution.
 *
 * Per request in a stream:
 *  - output tokens             → generation
 *  - cache-write tokens        → cache writes (own line; the invisible premium)
 *  - input-side cost (uncached input at 1x + cache reads at 0.1x) is distributed
 *    across the running *composition* of the context: each request's delta of
 *    new input tokens is classified by the tool results / user text that were
 *    appended since the previous request (Read → file reads, other tools →
 *    tool results, user text & residual → overhead), then the whole input-side
 *    dollar cost is split proportionally to the cumulative composition - you
 *    keep paying (at cache-read rates) for everything sitting in context.
 *  - negative delta            → compaction event: that request's uncached-input
 *    + cache-write spend goes to "compaction"; composition is rescaled.
 *
 * Invariant: category dollars sum exactly to total dollars (residual → overhead).
 */
import type { NormalizedRequest, NormalizedSession, Stream } from "./adapters/types.js";
import { lookupPrice } from "./cost/pricing.js";

export const CHARS_PER_TOKEN = 3.5;

export interface CompactionEvent {
  timestamp: string;
  costUSD: number;
  droppedTokens: number;
  subagent?: string;
}

export interface Categories {
  generationUSD: number;
  fileReadsUSD: number;
  toolResultsUSD: number;
  overheadUSD: number;
  cacheWritesUSD: number;
  compactionUSD: number;
}

export interface Attribution extends Categories {
  compactionEvents: CompactionEvent[];
}

function requestCostParts(req: NormalizedRequest) {
  const { price } = lookupPrice(req.model);
  const rateIn = price.inputPerMTok / 1e6;
  const rateOut = price.outputPerMTok / 1e6;
  const u = req.usage;
  const split = u.cache_creation;
  const w5m = split ? split.ephemeral_5m_input_tokens : u.cache_creation_input_tokens;
  const w1h = split ? split.ephemeral_1h_input_tokens : 0;
  return {
    uncachedInUSD: u.input_tokens * rateIn,
    cacheReadUSD: u.cache_read_input_tokens * rateIn * price.cacheReadMult,
    writeUSD: w5m * rateIn * price.cacheWrite5mMult + w1h * rateIn * price.cacheWrite1hMult,
    outUSD: u.output_tokens * rateOut,
    effIn: u.input_tokens + u.cache_read_input_tokens,
  };
}

function attributeStream(stream: Stream, acc: Attribution): void {
  // Running token composition of the context, by origin.
  const comp = { fileReads: 0, toolResults: 0, overhead: 0 };
  // Content appended since the previous request.
  let pend = { fileReadChars: 0, toolResultChars: 0, userChars: 0 };
  let prevEffIn: number | null = null;

  for (const ev of stream.events) {
    if (ev.kind === "toolResult") {
      if (ev.toolName === "Read") pend.fileReadChars += ev.chars;
      else pend.toolResultChars += ev.chars;
      continue;
    }
    if (ev.kind === "userPrompt") {
      pend.userChars += ev.chars;
      continue;
    }

    const req = ev.request;
    const { uncachedInUSD, cacheReadUSD, writeUSD, outUSD, effIn } = requestCostParts(req);
    acc.generationUSD += outUSD;

    let inputSideUSD = uncachedInUSD + cacheReadUSD;

    if (prevEffIn === null) {
      // First request: system prompt + CLAUDE.md + tool schemas → overhead.
      comp.overhead += effIn;
      acc.cacheWritesUSD += writeUSD;
    } else {
      const delta = effIn - prevEffIn;
      if (delta < 0) {
        // Context shrank → compaction. Direct cost: uncached input (the new
        // summary) + cache rebuild premium. Rescale composition, keep ratios.
        acc.compactionUSD += uncachedInUSD + writeUSD;
        inputSideUSD = cacheReadUSD;
        acc.compactionEvents.push({
          timestamp: req.timestamp,
          costUSD: uncachedInUSD + writeUSD,
          droppedTokens: -delta,
          subagent: stream.subagent,
        });
        const total = comp.fileReads + comp.toolResults + comp.overhead;
        const factor = total > 0 ? effIn / total : 0;
        comp.fileReads *= factor;
        comp.toolResults *= factor;
        comp.overhead *= factor;
      } else {
        // Classify the newly-added tokens by measured appended content.
        let remaining = delta;
        const take = (chars: number) => {
          const t = Math.min(chars / CHARS_PER_TOKEN, remaining);
          remaining -= t;
          return t;
        };
        comp.fileReads += take(pend.fileReadChars);
        comp.toolResults += take(pend.toolResultChars);
        comp.overhead += take(pend.userChars) + remaining; // residual → overhead
        acc.cacheWritesUSD += writeUSD;
      }
    }

    // Distribute the input-side cost across cumulative composition.
    const total = comp.fileReads + comp.toolResults + comp.overhead;
    if (total > 0) {
      acc.fileReadsUSD += (inputSideUSD * comp.fileReads) / total;
      acc.toolResultsUSD += (inputSideUSD * comp.toolResults) / total;
      acc.overheadUSD += (inputSideUSD * comp.overhead) / total;
    } else {
      acc.overheadUSD += inputSideUSD;
    }

    pend = { fileReadChars: 0, toolResultChars: 0, userChars: 0 };
    prevEffIn = effIn;
  }
}

export function attribute(session: NormalizedSession): Attribution {
  const acc: Attribution = {
    generationUSD: 0,
    fileReadsUSD: 0,
    toolResultsUSD: 0,
    overheadUSD: 0,
    cacheWritesUSD: 0,
    compactionUSD: 0,
    compactionEvents: [],
  };
  for (const stream of session.streams) attributeStream(stream, acc);
  return acc;
}

export function attributionTotalUSD(a: Categories): number {
  return (
    a.generationUSD +
    a.fileReadsUSD +
    a.toolResultsUSD +
    a.overheadUSD +
    a.cacheWritesUSD +
    a.compactionUSD
  );
}
