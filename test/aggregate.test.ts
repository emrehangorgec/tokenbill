import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { aggregate } from "../src/aggregate.js";
import { calculate } from "../src/cost/calculator.js";

const FILES = [
  "fixtures/basic.jsonl",
  "fixtures/subagent-session.jsonl",
  "fixtures/compaction.jsonl",
  "fixtures/multi-iteration.jsonl",
];

describe("aggregate across multiple sessions", () => {
  it("total equals the sum of each session's individual total", () => {
    const sessions = FILES.map((f) => claudeCodeAdapter.parse(f));
    const result = aggregate(sessions);
    const expected = sessions.reduce((a, s) => a + calculate(s).totalUSD, 0);
    expect(result.totalUSD).toBeCloseTo(expected, 8);
  });

  it("categories sum to total", () => {
    const sessions = FILES.map((f) => claudeCodeAdapter.parse(f));
    const result = aggregate(sessions);
    const catSum = Object.values(result.categories).reduce((a, b) => a + b, 0);
    expect(catSum).toBeCloseTo(result.totalUSD, 8);
  });

  it("session count and per-session summaries match input", () => {
    const sessions = FILES.map((f) => claudeCodeAdapter.parse(f));
    const result = aggregate(sessions);
    expect(result.sessionCount).toBe(FILES.length);
    expect(result.sessions).toHaveLength(FILES.length);
  });

  it("topTurns are tagged with their originating sessionId and globally sorted", () => {
    const sessions = FILES.map((f) => claudeCodeAdapter.parse(f));
    const result = aggregate(sessions, 5);
    expect(result.topTurns.length).toBeGreaterThan(0);
    for (const t of result.topTurns) expect(t.sessionId).toBeTruthy();
    for (let i = 1; i < result.topTurns.length; i++) {
      expect(result.topTurns[i - 1].costUSD).toBeGreaterThanOrEqual(result.topTurns[i].costUSD);
    }
  });

  it("cache hit rate is token-weighted across sessions, not averaged per-session", () => {
    const sessions = FILES.map((f) => claudeCodeAdapter.parse(f));
    const result = aggregate(sessions);
    const totalTokens = result.cache.tokens.read + result.cache.tokens.write + result.cache.tokens.uncached;
    expect(result.cache.hitRate).toBeCloseTo(result.cache.tokens.read / totalTokens, 10);
  });
});
