import { PRICING_AS_OF } from "../src/cost/pricing.js";

/**
 * Golden snapshots print the pricing table's `asOf` day, which the weekly
 * `pricing:sync` job bumps on every rate refresh. Left as-is that one line
 * turns every sync PR red for a reason nobody needs to review, so the date is
 * replaced with a fixed token before snapshotting. Rate-driven changes (costs,
 * layout, model rows) still surface as a normal snapshot diff.
 */
export function stablePricingDate(output: string): string {
  const stable = output
    .replace(/(prices as of )\d{4}-\d{2}-\d{2}/g, "$1<PRICING_AS_OF>")
    .replace(/("pricingAsOf":\s*)"\d{4}-\d{2}-\d{2}"/g, '$1"<PRICING_AS_OF>"');

  // A new report surface that prints the as-of day would reintroduce the churn
  // silently. Fail loudly instead so the pattern above gets extended.
  if (stable.includes(PRICING_AS_OF)) {
    throw new Error(
      `report still contains the pricing as-of day (${PRICING_AS_OF}) after ` +
        `normalization; add the new call site to stablePricingDate()`,
    );
  }
  return stable;
}
