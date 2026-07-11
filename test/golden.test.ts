import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { attribute } from "../src/attribute.js";
import { calculate } from "../src/cost/calculator.js";
import { renderReport } from "../src/report/terminal.js";
import { topTurns } from "../src/turns.js";

// Full-pipeline golden-file tests: any change to numbers or layout shows up
// as a reviewable snapshot diff. (Non-TTY test env → no ANSI codes.)
const FIXTURES = [
  "fixtures/basic.jsonl",
  "fixtures/subagent-session.jsonl",
  "fixtures/compaction.jsonl",
  "fixtures/multi-iteration.jsonl",
  "fixtures/corrupt.jsonl",
];

describe("golden report snapshots", () => {
  for (const f of FIXTURES) {
    it(f, () => {
      const session = claudeCodeAdapter.parse(f);
      const report = renderReport(session, calculate(session), attribute(session), topTurns(session));
      expect(report).toMatchSnapshot();
    });
  }
});
