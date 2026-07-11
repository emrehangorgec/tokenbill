import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { calculate, requestCostUSD } from "../src/cost/calculator.js";

describe("usage.iterations is never summed", () => {
  it("cost equals top-level usage priced once", () => {
    const session = claudeCodeAdapter.parse("fixtures/multi-iteration.jsonl");
    const cost = calculate(session);
    // Hand-computed from top-level usage @ sonnet rates ($3/$15 per MTok):
    // input 100*3e-6 + output 300*15e-6 + cacheRead 2000*3e-6*0.1 + write5m 500*3e-6*1.25
    const expected = 100 * 3e-6 + 300 * 15e-6 + 2000 * 3e-6 * 0.1 + 500 * 3e-6 * 1.25;
    expect(cost.totalUSD).toBeCloseTo(expected, 10);
    // and exactly one request contributes
    expect(cost.requestCount).toBe(1);
    expect(requestCostUSD(session.requests[0])).toBeCloseTo(expected, 10);
  });

  it("no invariant warning when iterations sum to top-level", () => {
    const session = claudeCodeAdapter.parse("fixtures/multi-iteration.jsonl");
    expect(session.warnings).toHaveLength(0);
  });
});
