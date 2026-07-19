import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../src/aggregate.js";
import { dailyTrend } from "../src/trends.js";

function session(startTime: string | undefined, costUSD: number): SessionSummary {
  return {
    sessionId: "s",
    sourcePath: "p",
    models: [],
    startTime,
    costUSD,
    requestCount: 1,
  };
}

describe("dailyTrend", () => {
  it("buckets by local date, zero-filled, oldest first", () => {
    const now = new Date(2026, 6, 16, 12, 0, 0);
    const t = dailyTrend(
      [session("2026-07-16T09:00:00", 2), session("2026-07-16T15:00:00", 3), session("2026-07-14T10:00:00", 1)],
      3,
      now,
    );
    expect(t.map((b) => b.date)).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
    expect(t.map((b) => b.costUSD)).toEqual([1, 0, 5]);
    expect(t.map((b) => b.sessions)).toEqual([1, 0, 2]);
  });

  it("skips sessions with missing or unparseable startTime", () => {
    const now = new Date(2026, 6, 16);
    const t = dailyTrend([session(undefined, 9), session("garbage", 9)], 2, now);
    expect(t.every((b) => b.costUSD === 0)).toBe(true);
  });

  it("ignores sessions outside the window", () => {
    const now = new Date(2026, 6, 16);
    const t = dailyTrend([session("2026-07-01T10:00:00", 9)], 3, now);
    expect(t.every((b) => b.costUSD === 0)).toBe(true);
  });

  it("anchors the window at the newest session when now is omitted", () => {
    const t = dailyTrend([session("2020-01-10T10:00:00", 4), session("2020-01-09T10:00:00", 2)], 3);
    expect(t[t.length - 1].date).toBe("2020-01-10");
    expect(t.map((b) => b.costUSD)).toEqual([0, 2, 4]);
  });
});
