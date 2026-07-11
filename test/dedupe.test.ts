import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";

describe("requestId dedupe", () => {
  it("counts usage once per requestId (multi-iteration fixture has 2 records, 1 request)", () => {
    const session = claudeCodeAdapter.parse("fixtures/multi-iteration.jsonl");
    expect(session.requests).toHaveLength(1);
    expect(session.requests[0].usage.output_tokens).toBe(300);
  });

  it("real anonymized session: request count < assistant record count", () => {
    const session = claudeCodeAdapter.parse("fixtures/basic.jsonl");
    // basic.jsonl has 14 assistant records; usage must be deduped well below that
    expect(session.requests.length).toBeGreaterThan(0);
    expect(session.requests.length).toBeLessThan(14);
    const ids = session.requests.map((r) => r.requestId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
