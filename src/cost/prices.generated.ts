// ---------------------------------------------------------------------------
// AUTO-GENERATED - DO NOT EDIT BY HAND.
//
// Regenerate with:  npm run pricing:sync
// Generator:        scripts/sync-pricing.ts
// Machine source:   LiteLLM model_prices_and_context_window.json
//                   (first-party `anthropic` provider entries only)
// Hand-curated:     src/cost/pricing.overrides.json - dimensions the feed does
//                   not model: promo windows, fast mode, batch tier, retired
//                   models.
//
// `asOf` is the day the rates below last changed (printed in reports).
//
// Regenerate manually with `npm run pricing:sync`; tokenbill makes no network
// calls at runtime.
// ---------------------------------------------------------------------------
import type { PriceTable } from "./pricing.js";

export const GENERATED_PRICES: PriceTable = {
  asOf: "2026-09-01",
  source: "litellm@main + pricing.overrides.json",
  batchMult: 0.5,
  serverTools: { webSearchPerRequest: 0.01, webFetchPerRequest: 0 },
  models: [
    { match: "claude-3-5-haiku", inputPerMTok: 0.8, outputPerMTok: 4, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-3-5-sonnet", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-3-7-sonnet", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-3-7-sonnet-20250219", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-3-haiku", inputPerMTok: 0.25, outputPerMTok: 1.25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-3-haiku-20240307", inputPerMTok: 0.25, outputPerMTok: 1.25, cacheReadMult: 0.12, cacheWrite5mMult: 1.2, cacheWrite1hMult: 2 },
    { match: "claude-3-opus", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-3-opus-20240229", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-3-sonnet", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-4-opus-20250514", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-4-sonnet-20250514", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-fable-5", inputPerMTok: 10, outputPerMTok: 50, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-haiku-3", inputPerMTok: 0.25, outputPerMTok: 1.25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-haiku-4-5", inputPerMTok: 1, outputPerMTok: 5, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-haiku-4-5-20251001", inputPerMTok: 1, outputPerMTok: 5, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-mythos-5", inputPerMTok: 10, outputPerMTok: 50, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "Project Glasswing; absent from the public feed" },
    { match: "claude-mythos-preview", inputPerMTok: 10, outputPerMTok: 50, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-0", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "pre-4.5 Opus tier" },
    { match: "claude-opus-4-1", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "pre-4.5 Opus tier" },
    { match: "claude-opus-4-1-20250805", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-20250514", inputPerMTok: 15, outputPerMTok: 75, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "pre-4.5 Opus tier" },
    { match: "claude-opus-4-5", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-5-20251101", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-6", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-6-20260205", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-7", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-7-20260416", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-opus-4-8", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, fast: { inputPerMTok: 10, outputPerMTok: 50 } },
    { match: "claude-opus-5", inputPerMTok: 5, outputPerMTok: 25, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, fast: { inputPerMTok: 10, outputPerMTok: 50 } },
    { match: "claude-sonnet-4-0", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, note: "retired model, rate frozen" },
    { match: "claude-sonnet-4-20250514", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-sonnet-4-5", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-sonnet-4-5-20250929", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-sonnet-4-6", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 },
    { match: "claude-sonnet-5", inputPerMTok: 2, outputPerMTok: 10, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, effectiveTo: "2026-08-31", note: "introductory pricing" },
    { match: "claude-sonnet-5", inputPerMTok: 3, outputPerMTok: 15, cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, effectiveFrom: "2026-09-01", note: "standard rate after intro period" },
  ],
};
