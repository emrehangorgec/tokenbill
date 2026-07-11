import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { calculate } from "../src/cost/calculator.js";
import { segmentTurns, topTurns } from "../src/turns.js";

describe("turn segmentation", () => {
  it("turn costs sum to session total (subagent requests folded in)", () => {
    const session = claudeCodeAdapter.parse("fixtures/subagent-session.jsonl");
    const turns = segmentTurns(session);
    const sum = turns.reduce((a, t) => a + t.costUSD, 0);
    expect(sum).toBeCloseTo(calculate(session).totalUSD, 8);
  });

  it("turns have descriptions and are sorted by cost in topTurns", () => {
    const session = claudeCodeAdapter.parse("fixtures/basic.jsonl");
    const top = topTurns(session, 10);
    expect(top.length).toBeGreaterThan(0);
    for (const t of top) expect(t.description.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].costUSD).toBeGreaterThanOrEqual(top[i].costUSD);
    }
  });

  it("compaction is flagged on the containing turn", () => {
    const session = claudeCodeAdapter.parse("fixtures/compaction.jsonl");
    const turns = segmentTurns(session);
    expect(turns.some((t) => t.hasCompaction)).toBe(true);
    expect(turns.some((t) => t.description.includes("context compacted"))).toBe(true);
  });

  it("subagent presence appears in the turn description", () => {
    const session = claudeCodeAdapter.parse("fixtures/subagent-session.jsonl");
    const turns = segmentTurns(session);
    expect(turns.some((t) => t.subagents.size > 0)).toBe(true);
  });
});
