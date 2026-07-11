import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { attribute } from "../src/attribute.js";
import { analyzeCache } from "../src/cost/cache.js";
import { calculate } from "../src/cost/calculator.js";
import { renderJson } from "../src/report/json.js";
import { topTurns } from "../src/turns.js";

function pipeline(fixture: string) {
  const session = claudeCodeAdapter.parse(fixture);
  return renderJson(
    session,
    calculate(session),
    attribute(session),
    topTurns(session),
    analyzeCache(session),
  );
}

describe("--json output", () => {
  it("is valid JSON with the documented shape", () => {
    const data = JSON.parse(pipeline("fixtures/compaction.jsonl"));
    expect(data.schemaVersion).toBe(1);
    expect(data.totalUSD).toBeGreaterThan(0);
    expect(data.categories).toHaveProperty("compactionUSD");
    expect(data.compactionEvents).toHaveLength(1);
    expect(data.cache).toHaveProperty("hitRate");
    expect(data.topTurns.length).toBeGreaterThan(0);
    // categories sum to total (rounded)
    const catSum = Object.values(data.categories as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(catSum).toBeCloseTo(data.totalUSD, 4);
  });

  it("golden snapshot (subagent session)", () => {
    expect(pipeline("fixtures/subagent-session.jsonl")).toMatchSnapshot();
  });
});
