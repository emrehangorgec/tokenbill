import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { NormalizedRequest, Usage } from "../src/adapters/types.js";
import { calculate, requestCostUSD } from "../src/cost/calculator.js";
import { lookupPrice, PRICE_TABLE } from "../src/cost/pricing.js";

const MTOK = 1_000_000;

function req(model: string, timestamp: string, usage: Partial<Usage>): NormalizedRequest {
  return {
    requestId: "req_test",
    model,
    timestamp,
    toolCalls: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      ...usage,
    },
  };
}

describe("price lookup (longest prefix)", () => {
  it("matches dated model ids", () => {
    const r = lookupPrice("claude-haiku-4-5-20251001");
    expect(r.exact).toBe(true);
    expect(r.price.inputPerMTok).toBe(1);
  });

  it("prefers the most specific prefix", () => {
    expect(lookupPrice("claude-sonnet-5").price.match).toBe("claude-sonnet-5");
    expect(lookupPrice("claude-sonnet-4-6").price.match).toBe("claude-sonnet-4-6");
  });

  it("prices claude-opus-5 exactly", () => {
    // Regression: a bare "claude-opus-4" prefix never matched "claude-opus-5",
    // so the default Claude Code model fell through to Sonnet rates and every
    // bill came out ~40% light.
    const r = lookupPrice("claude-opus-5");
    expect(r.exact).toBe(true);
    expect(r.price.inputPerMTok).toBe(5);
    expect(r.price.outputPerMTok).toBe(25);
  });

  it("does not price pre-4.5 Opus at post-4.5 rates", () => {
    // The reverse hazard of a generic prefix: Opus 4.1 is $15/$75 while Opus
    // 4.5+ is $5/$25, so one "claude-opus-4" row would have to be wrong for one
    // of them. Both are explicit instead.
    expect(lookupPrice("claude-opus-4-1").price.inputPerMTok).toBe(15);
    expect(lookupPrice("claude-opus-4-5").price.inputPerMTok).toBe(5);
    expect(lookupPrice("claude-opus-4-8").price.outputPerMTok).toBe(25);
  });

  it("covers the legacy models", () => {
    expect(lookupPrice("claude-3-opus-20240229").exact).toBe(true);
    expect(lookupPrice("claude-3-5-sonnet-20241022").exact).toBe(true);
    expect(lookupPrice("claude-3-haiku-20240307").exact).toBe(true);
    expect(lookupPrice("claude-fable-5").price.inputPerMTok).toBe(10);
  });

  it("unknown model falls back to sonnet rates, flagged", () => {
    const r = lookupPrice("gpt-9-mega");
    expect(r.exact).toBe(false);
    expect(r.price.inputPerMTok).toBe(3);
  });
});

describe("effective-date windows", () => {
  it("applies the introductory rate before the boundary and the standard rate after", () => {
    // Sonnet 5 runs at an introductory $2/$10 through 2026-08-31. A single rate
    // per model would mis-price every session on one side of that date.
    expect(lookupPrice("claude-sonnet-5", "2026-08-31T23:00:00.000Z").price.inputPerMTok).toBe(2);
    expect(lookupPrice("claude-sonnet-5", "2026-09-01T00:30:00.000Z").price.inputPerMTok).toBe(3);
    expect(lookupPrice("claude-sonnet-5", "2026-09-01T00:30:00.000Z").price.outputPerMTok).toBe(15);
  });

  it("prices a request against its own timestamp", () => {
    const usage = { input_tokens: MTOK, output_tokens: MTOK };
    expect(requestCostUSD(req("claude-sonnet-5", "2026-08-01T12:00:00.000Z", usage))).toBeCloseTo(
      12,
      6,
    );
    expect(requestCostUSD(req("claude-sonnet-5", "2026-10-01T12:00:00.000Z", usage))).toBeCloseTo(
      18,
      6,
    );
  });

  it("falls back to the table's own as-of day when a timestamp is missing", () => {
    expect(lookupPrice("claude-sonnet-5", "").exact).toBe(true);
    expect(lookupPrice("claude-sonnet-5", "not-a-date").exact).toBe(true);
  });

  it("every model in the shipped table has exactly one rate in force", () => {
    // Invariant on the generated table: a lapsed window would drop a model to
    // the flagged fallback, and overlapping windows would make the lookup
    // depend on row order.
    const day = new Date().toISOString().slice(0, 10);
    const active = new Map<string, number>();
    for (const p of PRICE_TABLE) {
      if (p.effectiveFrom && day < p.effectiveFrom) continue;
      if (p.effectiveTo && day > p.effectiveTo) continue;
      active.set(p.match, (active.get(p.match) ?? 0) + 1);
    }
    const ambiguous = [...active].filter(([, n]) => n > 1).map(([m]) => m);
    const lapsed = [...new Set(PRICE_TABLE.map((p) => p.match))].filter((m) => !active.has(m));
    expect(ambiguous).toEqual([]);
    expect(lapsed).toEqual([]);
  });
});

describe("fast mode and service tier", () => {
  const usage = { input_tokens: MTOK, output_tokens: MTOK };

  it("charges standard Opus 5 rates by default", () => {
    expect(requestCostUSD(req("claude-opus-5", "2026-07-01T00:00:00.000Z", usage))).toBeCloseTo(
      30,
      6,
    );
  });

  it("charges the fast-mode premium when usage.speed says so", () => {
    // Opus 5 fast mode is $10/$50 - exactly double. Ignoring usage.speed
    // under-reports a fast-mode session by half.
    const fast = { ...usage, speed: "fast" };
    expect(requestCostUSD(req("claude-opus-5", "2026-07-01T00:00:00.000Z", fast))).toBeCloseTo(
      60,
      6,
    );
  });

  it("ignores fast mode for models that have no fast rate", () => {
    const fast = { ...usage, speed: "fast" };
    expect(requestCostUSD(req("claude-opus-4-7", "2026-07-01T00:00:00.000Z", fast))).toBeCloseTo(
      30,
      6,
    );
  });

  it("discounts the batch tier", () => {
    const batch = { ...usage, service_tier: "batch" };
    expect(requestCostUSD(req("claude-opus-5", "2026-07-01T00:00:00.000Z", batch))).toBeCloseTo(
      15,
      6,
    );
  });

  it("treats standard and priority tiers at list price", () => {
    for (const tier of ["standard", "priority"]) {
      const r = req("claude-opus-5", "2026-07-01T00:00:00.000Z", { ...usage, service_tier: tier });
      expect(requestCostUSD(r)).toBeCloseTo(30, 6);
    }
  });

  it("applies the cache multipliers on top of the fast-mode base rate", () => {
    const r = req("claude-opus-5", "2026-07-01T00:00:00.000Z", {
      cache_read_input_tokens: MTOK,
      speed: "fast",
    });
    // fast input $10/MTok x 0.1 cache-read multiplier
    expect(requestCostUSD(r)).toBeCloseTo(1, 6);
  });
});

describe("pricing dimensions end to end", () => {
  it("reads speed and service_tier off real log records", () => {
    // Proves the adapter picks both fields out of message.usage, not just that
    // the calculator honours them once they are set by hand.
    const session = claudeCodeAdapter.parse("fixtures/pricing-dimensions.jsonl");
    const cost = calculate(session);
    expect(session.requests.map((r) => r.usage.speed)).toEqual([undefined, "fast", undefined]);
    expect(session.requests.map((r) => r.usage.service_tier)).toEqual([
      "standard",
      "standard",
      "batch",
    ]);
    // 100K in + 20K out on Opus 5: $1.00 standard, $2.00 fast, $0.50 batch.
    expect(session.requests.map((r) => requestCostUSD(r))).toEqual([1, 2, 0.5]);
    expect(cost.totalUSD).toBeCloseTo(3.5, 6);
    expect(cost.perModel[0].pricedExactly).toBe(true);
  });

  it("flags a model it has no rate for instead of quietly guessing", () => {
    const session = claudeCodeAdapter.parse("fixtures/unknown-model.jsonl");
    const cost = calculate(session);
    expect(cost.perModel[0].model).toBe("claude-zephyr-9");
    expect(cost.perModel[0].pricedExactly).toBe(false);
    // Fallback Sonnet rates: 0.1M x $3 + 0.02M x $15.
    expect(cost.totalUSD).toBeCloseTo(0.6, 6);
  });
});
