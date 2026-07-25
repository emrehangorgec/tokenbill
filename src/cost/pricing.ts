export const PRICING_AS_OF = "2026-07-25";

export interface ModelPrice {
  match: string; // longest-prefix match against the model id
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMult: number;
  cacheWrite5mMult: number;
  cacheWrite1hMult: number;
}

const DEFAULT_MULTS = { cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 };

export const PRICE_TABLE: ModelPrice[] = [
  { match: "claude-fable-5", inputPerMTok: 10, outputPerMTok: 50, ...DEFAULT_MULTS },
  { match: "claude-mythos-5", inputPerMTok: 10, outputPerMTok: 50, ...DEFAULT_MULTS },
  { match: "claude-opus-4", inputPerMTok: 5, outputPerMTok: 25, ...DEFAULT_MULTS },
  { match: "claude-sonnet-5", inputPerMTok: 3, outputPerMTok: 15, ...DEFAULT_MULTS },
  { match: "claude-sonnet-4", inputPerMTok: 3, outputPerMTok: 15, ...DEFAULT_MULTS },
  { match: "claude-haiku-4-5", inputPerMTok: 1, outputPerMTok: 5, ...DEFAULT_MULTS },
];

// Fallback for unknown models: sonnet rates, flagged by the caller.
export const FALLBACK_PRICE: ModelPrice = {
  match: "(unknown)",
  inputPerMTok: 3,
  outputPerMTok: 15,
  ...DEFAULT_MULTS,
};

/**
 * Server-side tools are billed per request, not per token.
 *  - web search: $10 per 1,000 searches (errored searches are not billed, and
 *    the logs only record requests that were actually charged).
 *  - web fetch: no per-request charge - you pay only the tokens the fetched
 *    content adds to the context, which the token-based categories already
 *    capture. Kept as an explicit 0 so it shows up in --pricing overrides.
 */
export interface ServerToolPrice {
  webSearchPerRequest: number;
  webFetchPerRequest: number;
}

export const SERVER_TOOL_PRICING: ServerToolPrice = {
  webSearchPerRequest: 0.01,
  webFetchPerRequest: 0,
};

/** Replace the built-in table with a user-supplied JSON array (--pricing file). */
export function overridePricing(entries: ModelPrice[]): void {
  PRICE_TABLE.splice(0, PRICE_TABLE.length, ...entries);
}

/** Override per-request server tool prices (--pricing file, object form). */
export function overrideServerToolPricing(prices: Partial<ServerToolPrice>): void {
  Object.assign(SERVER_TOOL_PRICING, prices);
}

export interface PriceLookup {
  price: ModelPrice;
  exact: boolean; // false when fallback was used
}

export function lookupPrice(modelId: string): PriceLookup {
  let best: ModelPrice | undefined;
  for (const p of PRICE_TABLE) {
    if (modelId.startsWith(p.match) && (!best || p.match.length > best.match.length)) {
      best = p;
    }
  }
  return best ? { price: best, exact: true } : { price: FALLBACK_PRICE, exact: false };
}
