export const PRICING_AS_OF = "2026-07-11";

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

/** Replace the built-in table with a user-supplied JSON array (--pricing file). */
export function overridePricing(entries: ModelPrice[]): void {
  PRICE_TABLE.splice(0, PRICE_TABLE.length, ...entries);
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
