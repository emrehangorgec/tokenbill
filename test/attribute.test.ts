import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { attribute, attributionTotalUSD } from "../src/attribute.js";
import { calculate } from "../src/cost/calculator.js";

const FIXTURES = [
  "fixtures/basic.jsonl",
  "fixtures/subagent-session.jsonl",
  "fixtures/multi-iteration.jsonl",
  "fixtures/compaction.jsonl",
  "fixtures/corrupt.jsonl",
];

describe("attribution invariant", () => {
  for (const f of FIXTURES) {
    it(`categories sum exactly to total (${f})`, () => {
      const session = claudeCodeAdapter.parse(f);
      const attr = attribute(session);
      const cost = calculate(session);
      expect(attributionTotalUSD(attr)).toBeCloseTo(cost.totalUSD, 8);
    });
  }
});

describe("category classification", () => {
  it("Read tool results land in fileReads, others in toolResults (basic)", () => {
    const session = claudeCodeAdapter.parse("fixtures/basic.jsonl");
    const attr = attribute(session);
    expect(attr.fileReadsUSD).toBeGreaterThan(0);
    expect(attr.toolResultsUSD).toBeGreaterThan(0);
    expect(attr.overheadUSD).toBeGreaterThan(0);
    expect(attr.compactionEvents).toHaveLength(0);
  });
});

describe("compaction detection", () => {
  it("negative input delta produces an explicit compaction event with cost", () => {
    const session = claudeCodeAdapter.parse("fixtures/compaction.jsonl");
    const attr = attribute(session);
    expect(attr.compactionEvents).toHaveLength(1);
    const ev = attr.compactionEvents[0];
    // req_2 effIn = 180100; req_3 effIn = 8000 → dropped 172100
    expect(ev.droppedTokens).toBe(172100);
    // cost = req_3 uncached input (8000 @ $3/M) + cache write (9000 @ 1.25x)
    expect(ev.costUSD).toBeCloseTo(8000 * 3e-6 + 9000 * 3e-6 * 1.25, 10);
    expect(attr.compactionUSD).toBeCloseTo(ev.costUSD, 10);
  });

  it("no compaction on monotonically growing sessions", () => {
    const session = claudeCodeAdapter.parse("fixtures/basic.jsonl");
    expect(attribute(session).compactionEvents).toHaveLength(0);
  });
});
