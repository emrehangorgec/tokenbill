import { GENERATED_PRICES } from "./prices.generated.js";

/** Fast mode (`usage.speed === "fast"`) runs the same model at premium rates. */
export interface FastModePrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface ModelPrice {
  match: string; // longest-prefix match against the model id
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMult: number;
  cacheWrite5mMult: number;
  cacheWrite1hMult: number;
  /**
   * Inclusive ISO day (YYYY-MM-DD) this rate starts / stops applying. Absent
   * means open-ended. Anthropic ships promotional rates with real end dates
   * (Sonnet 5's introductory $2/$10 runs through 2026-08-31), so a single
   * number per model would mis-price every session on the wrong side of the
   * boundary. Requests are priced against their own timestamp.
   */
  effectiveFrom?: string;
  effectiveTo?: string;
  fast?: FastModePrice;
  /** Provenance for hand-curated rows. */
  note?: string;
}

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

/** The shape `src/cost/prices.generated.ts` emits. */
export interface PriceTable {
  /**
   * ISO day the rates below last *changed*. This is what reports print: it is
   * the honest answer to "how current are these numbers".
   */
  asOf: string;
  /** Human-readable provenance, e.g. "litellm@main + pricing.overrides.json". */
  source: string;
  models: ModelPrice[];
  serverTools: ServerToolPrice;
  /** Multiplier on every token class when `usage.service_tier === "batch"`. */
  batchMult: number;
}

export const PRICE_TABLE: ModelPrice[] = GENERATED_PRICES.models.map((m) => ({ ...m }));

export const SERVER_TOOL_PRICING: ServerToolPrice = { ...GENERATED_PRICES.serverTools };

/** Batch service tier discount. Priority tier is not modelled - see README caveats. */
export const TIER_MULTIPLIERS = { batch: GENERATED_PRICES.batchMult };

/**
 * The day the shipped rates last changed. Reports print this so a reader can
 * judge how much to trust the numbers.
 */
export const PRICING_AS_OF = GENERATED_PRICES.asOf;

let overridden = false;

/** Replace the built-in table with a user-supplied JSON array (--pricing file). */
export function overridePricing(entries: ModelPrice[]): void {
  PRICE_TABLE.splice(0, PRICE_TABLE.length, ...entries);
  overridden = true;
}

/** Override per-request server tool prices (--pricing file, object form). */
export function overrideServerToolPricing(prices: Partial<ServerToolPrice>): void {
  Object.assign(SERVER_TOOL_PRICING, prices);
  overridden = true;
}

/** What the report footer should call the current price source. */
export function pricingLabel(): string {
  return overridden ? "custom --pricing file" : PRICING_AS_OF;
}

// --- effective-date resolution ---------------------------------------------

function isActiveOn(p: ModelPrice, day: string): boolean {
  if (p.effectiveFrom && day < p.effectiveFrom) return false;
  if (p.effectiveTo && day > p.effectiveTo) return false;
  return true;
}

/**
 * Which day to price against. A request timestamp when we have one, otherwise
 * the table's own as-of day - deterministic, and it resolves to whatever rate
 * was current when the table was built.
 */
function referenceDay(at?: string): string {
  if (at) {
    const t = Date.parse(at);
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return PRICING_AS_OF;
}

export interface PriceLookup {
  price: ModelPrice;
  exact: boolean; // false when fallback was used
}

// Fallback for unknown models: sonnet rates, flagged by the caller.
export const FALLBACK_PRICE: ModelPrice = {
  match: "(unknown)",
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheReadMult: 0.1,
  cacheWrite5mMult: 1.25,
  cacheWrite1hMult: 2,
};

/**
 * Longest-prefix match, restricted to rows whose effective window contains
 * `at`. Ties on prefix length go to the row that starts later, so a newer rate
 * wins over an older open-ended one.
 */
export function lookupPrice(modelId: string, at?: string): PriceLookup {
  const day = referenceDay(at);
  let best: ModelPrice | undefined;
  for (const p of PRICE_TABLE) {
    if (!modelId.startsWith(p.match)) continue;
    if (!isActiveOn(p, day)) continue;
    if (!best) {
      best = p;
    } else if (p.match.length > best.match.length) {
      best = p;
    } else if (
      p.match.length === best.match.length &&
      (p.effectiveFrom ?? "") > (best.effectiveFrom ?? "")
    ) {
      best = p;
    }
  }
  return best ? { price: best, exact: true } : { price: FALLBACK_PRICE, exact: false };
}
