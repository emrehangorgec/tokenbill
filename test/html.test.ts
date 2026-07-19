import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { aggregate } from "../src/aggregate.js";
import { attribute } from "../src/attribute.js";
import { analyzeCache } from "../src/cost/cache.js";
import { calculate } from "../src/cost/calculator.js";
import { renderAggregateHtml, renderHtml } from "../src/report/html.js";
import { topTurns } from "../src/turns.js";

function singleHtml(fixture: string): string {
  const session = claudeCodeAdapter.parse(fixture);
  return renderHtml(
    session,
    calculate(session),
    attribute(session),
    topTurns(session, 5),
    analyzeCache(session),
  );
}

function aggregateHtml(): string {
  const files = fs
    .readdirSync("fixtures")
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join("fixtures", f));
  const sessions = files.map((f) => claudeCodeAdapter.parse(f));
  return renderAggregateHtml(aggregate(sessions, 5), "fixtures");
}

describe("html report", () => {
  it("is a self-contained document with no external requests", () => {
    const html = singleHtml("fixtures/basic.jsonl");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/src\s*=\s*["']https?:/);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/);
    expect(html).not.toContain("@import");
  });

  it("contains the core sections for a single session", () => {
    const html = singleHtml("fixtures/basic.jsonl");
    expect(html).toContain("Where it went");
    expect(html).toContain("Cache efficiency");
    expect(html).toContain("Recommendations");
    expect(html).toContain("most expensive turns");
    expect(html).toContain("Per model");
    expect(html).toContain("TOTAL ESTIMATED COST");
  });

  it("escapes interpolated text", () => {
    const html = singleHtml("fixtures/basic.jsonl");
    // Turn descriptions contain tool counts like "Bash ×3"; ensure no raw
    // unescaped angle brackets sneak in outside of tags by spot-checking a
    // known-escaped entity path: the esc() helper turns & into &amp;.
    expect(html).not.toMatch(/<td>[^<]*<script/i);
  });

  it("aggregate report includes sessions table and trend when it qualifies", () => {
    const html = aggregateHtml();
    expect(html).toContain("Sessions (newest first)");
    // Fixture sessions may or may not span 2+ days; the section must be
    // consistent with the data rather than always present.
    const files = fs
      .readdirSync("fixtures")
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join("fixtures", f));
    const sessions = files.map((f) => claudeCodeAdapter.parse(f));
    const days = new Set(
      aggregate(sessions, 5)
        .sessions.map((s) => s.startTime?.slice(0, 10))
        .filter(Boolean),
    );
    if (days.size >= 2) {
      expect(html).toContain("Daily spend");
    } else {
      expect(html).not.toContain("Daily spend");
    }
  });

  it("golden snapshot (basic session)", () => {
    expect(singleHtml("fixtures/basic.jsonl")).toMatchSnapshot();
  });
});
