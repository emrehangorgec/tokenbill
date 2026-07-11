import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { analyzeCache } from "../src/cost/cache.js";

describe("cache analysis", () => {
  it("hit rate and savings on a warm session (basic)", () => {
    const session = claudeCodeAdapter.parse("fixtures/basic.jsonl");
    const cache = analyzeCache(session);
    expect(cache.hitRate).toBeGreaterThan(0.5);
    expect(cache.hitRate).toBeLessThanOrEqual(1);
    expect(cache.savedUSD).toBeGreaterThan(0);
  });

  it("detects mid-session rebuild as invalidation (compaction fixture)", () => {
    const session = claudeCodeAdapter.parse("fixtures/compaction.jsonl");
    const cache = analyzeCache(session);
    // req_3: cache_creation 9000 > cache_read 0 → rebuild
    expect(cache.invalidations).toBe(1);
    // wasted = premium only: 9000 * 3e-6 * 0.25
    expect(cache.wastedUSD).toBeCloseTo(9000 * 3e-6 * 0.25, 10);
  });

  it("first request's cold write is never counted as waste", () => {
    const session = claudeCodeAdapter.parse("fixtures/corrupt.jsonl");
    const cache = analyzeCache(session);
    expect(cache.invalidations).toBe(0);
    expect(cache.wastedUSD).toBe(0);
  });
});
