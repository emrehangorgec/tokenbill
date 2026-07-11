import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { calculate } from "../src/cost/calculator.js";

describe("calculator on fixtures", () => {
  it("basic session: positive cost, fable model, no skipped lines", () => {
    const session = claudeCodeAdapter.parse("fixtures/basic.jsonl");
    const cost = calculate(session);
    expect(cost.totalUSD).toBeGreaterThan(0);
    expect(session.models).toContain("claude-fable-5");
    expect(session.skippedLines).toBe(0);
  });

  it("subagent session: subagent requests folded in and attributed", () => {
    const session = claudeCodeAdapter.parse("fixtures/subagent-session.jsonl");
    const cost = calculate(session);
    expect(session.requests.some((r) => r.subagent)).toBe(true);
    expect(cost.subagentUSD).toBeGreaterThan(0);
    expect(cost.subagentUSD).toBeLessThan(cost.totalUSD);
    expect(session.models).toContain("claude-haiku-4-5-20251001");
  });

  it("corrupt lines are skipped and counted, never crash", () => {
    const session = claudeCodeAdapter.parse("fixtures/corrupt.jsonl");
    expect(session.skippedLines).toBe(2);
    expect(session.requests).toHaveLength(2);
    const cost = calculate(session);
    // 2 requests × (50 in + 100 out) @ haiku $1/$5 per MTok
    expect(cost.totalUSD).toBeCloseTo(2 * (50 * 1e-6 + 100 * 5e-6), 10);
  });

  it("per-model breakdown sums to total", () => {
    const session = claudeCodeAdapter.parse("fixtures/subagent-session.jsonl");
    const cost = calculate(session);
    const sum = cost.perModel.reduce((a, m) => a + m.costUSD, 0);
    expect(sum).toBeCloseTo(cost.totalUSD, 10);
  });
});
