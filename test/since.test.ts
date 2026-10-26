import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const TSX_CLI = path.join(path.dirname(require_.resolve("tsx/package.json")), "dist/cli.mjs");
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokenbill-since-"));
  homes.push(home);
  const project = path.join(home, ".claude", "projects", "project-a");
  fs.mkdirSync(project, { recursive: true });
  const content = fs.readFileSync("fixtures/basic.jsonl", "utf8");
  for (const [id, timestamp] of [
    ["before", "2026-09-30T23:59:59.999Z"],
    ["boundary", "2026-10-01T00:00:00.000Z"],
    ["after", "2026-10-02T12:00:00.000Z"],
    ["unknown", undefined],
  ] as const) {
    const records = content.trim().split(/\r?\n/).map((line) => {
      const record = JSON.parse(line);
      record.sessionId = id;
      if (record.timestamp) {
        if (timestamp) record.timestamp = timestamp;
        else delete record.timestamp;
      }
      return JSON.stringify(record);
    });
    fs.writeFileSync(path.join(project, `${id}.jsonl`), records.join("\n"));
  }
  return { home, project };
}

function run(home: string, args: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, "src/cli.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

describe("--since", () => {
  it.each([false, true])("filters whole sessions inclusively with all=%s", (all) => {
    const { home, project } = setup();
    const args = all ? ["--all"] : [project];
    const unfiltered = run(home, [...args, "--json"]);
    expect(unfiltered.status).toBe(0);
    expect(JSON.parse(unfiltered.stdout).sessionCount).toBe(4);
    const result = run(home, [...args, "--since", "2026-10-01", "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.sessions.map((s: { sessionId: string }) => s.sessionId).sort())
      .toEqual(["after", "boundary"]);
    const expectedTotal = JSON.parse(unfiltered.stdout).sessions
      .filter((s: { sessionId: string }) => ["after", "boundary"].includes(s.sessionId))
      .reduce((sum: number, s: { costUSD: number }) => sum + s.costUSD, 0);
    expect(report.totalUSD).toBeCloseTo(expectedTotal, 6);
    const budget = run(home, [...args, "--since", "2026-10-01", "--budget", String(expectedTotal * 1.1), "--json"]);
    expect(budget.status).toBe(0);
  });

  it("applies to single sessions and explains when nothing matches", () => {
    const { home, project } = setup();
    const included = run(home, [path.join(project, "boundary.jsonl"), "--since", "2026-10-01", "--json"]);
    expect(included.status).toBe(0);
    for (const args of [[project], [path.join(project, "before.jsonl")], ["--all"]]) {
      const result = run(home, [...args, "--since", "2026-11-01", "--json"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("No sessions starting on or after 2026-11-01");
    }
  });

  it("rejects missing, malformed and impossible dates while allowing leap days", () => {
    const { home, project } = setup();
    for (const value of [undefined, "yesterday", "2026-2-01", "2026-02-29", "2026-04-31", "2026-13-01"]) {
      const result = run(home, [project, "--since", ...(value ? [value] : [])]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--since expects a valid date");
    }
    expect(run(home, [project, "--since", "2024-02-29", "--json"]).status).toBe(0);
  });

  it("rejects malformed relative durations", () => {
    const { home, project } = setup();
    for (const value of ["7x", "0d", "0w", "-3d", "d", "7", "7dd", "1.5d", "300000000d", "99999999999w"]) {
      const result = run(home, [project, "--since", value]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--since expects a valid date");
    }
  });

  it("resolves relative durations to today minus n-1 days (UTC), inclusive", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokenbill-since-rel-"));
    homes.push(home);
    const project = path.join(home, ".claude", "projects", "project-a");
    fs.mkdirSync(project, { recursive: true });
    const content = fs.readFileSync("fixtures/basic.jsonl", "utf8");
    const todayUTC = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    // "justInside" sits on the boundary day for --since 7d; "justOutside" is one day older.
    for (const [id, offsetDays] of [["justInside", 6], ["justOutside", 7]] as const) {
      const timestamp = new Date(todayUTC - offsetDays * 864e5 + 3600e3).toISOString();
      const records = content.trim().split(/\r?\n/).map((line) => {
        const record = JSON.parse(line);
        record.sessionId = id;
        if (record.timestamp) record.timestamp = timestamp;
        return JSON.stringify(record);
      });
      fs.writeFileSync(path.join(project, `${id}.jsonl`), records.join("\n"));
    }
    const result = run(home, [project, "--since", "7d", "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(["justInside"]);
  });

  it("treats 1w as equivalent to 7d", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokenbill-since-week-"));
    homes.push(home);
    const project = path.join(home, ".claude", "projects", "project-a");
    fs.mkdirSync(project, { recursive: true });
    const content = fs.readFileSync("fixtures/basic.jsonl", "utf8");
    const todayUTC = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    const timestamp = new Date(todayUTC - 6 * 864e5 + 3600e3).toISOString();
    const records = content.trim().split(/\r?\n/).map((line) => {
      const record = JSON.parse(line);
      record.sessionId = "boundary";
      if (record.timestamp) record.timestamp = timestamp;
      return JSON.stringify(record);
    });
    fs.writeFileSync(path.join(project, "boundary.jsonl"), records.join("\n"));
    const daysResult = run(home, [project, "--since", "7d", "--json"]);
    const weeksResult = run(home, [project, "--since", "1w", "--json"]);
    expect(daysResult.status).toBe(0);
    expect(weeksResult.status).toBe(0);
    expect(JSON.parse(weeksResult.stdout)).toEqual(JSON.parse(daysResult.stdout));
  });
}, 60_000);


describe("--until", () => {
  it.each([false, true])("includes the final UTC millisecond but not the next day with all=%s", (all) => {
    const { home, project } = setup();
    const args = all ? ["--all"] : [project];
    const result = run(home, [...args, "--until", "2026-09-30", "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(["before"]);
    const single = run(home, [path.join(project, "before.jsonl"), "--until", "2026-09-30", "--json"]);
    expect(single.status).toBe(0);
    expect(report.totalUSD).toBeCloseTo(JSON.parse(single.stdout).totalUSD, 6);
  });

  it("combines both bounds and accepts a single-day window", () => {
    const { home, project } = setup();
    const result = run(home, [project, "--since", "2026-10-01", "--until", "2026-10-01", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).sessions.map((s: { sessionId: string }) => s.sessionId))
      .toEqual(["boundary"]);
  });

  it("rejects inverted windows in either argument order", () => {
    const { home, project } = setup();
    for (const flags of [
      ["--since", "2026-10-01", "--until", "2026-09-30"],
      ["--until", "2026-09-30", "--since", "2026-10-01"],
    ]) {
      const result = run(home, [project, ...flags, "--json"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--until must be on or after --since");
      expect(result.stdout).toBe("");
    }
  });

  it("reports no matches for projects, single sessions and --all", () => {
    const { home, project } = setup();
    for (const args of [[project], [path.join(project, "boundary.jsonl")], ["--all"]]) {
      const result = run(home, [...args, "--until", "2026-09-01", "--json"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No sessions starting on or before 2026-09-01");
      expect(result.stdout).toBe("");
    }
  });

  it("uses the same date validation as --since", () => {
    const { home, project } = setup();
    for (const value of [undefined, "yesterday", "2026-2-01", "2026-02-29", "2026-04-31", "0d", "-3d", "1.5d", "300000000d"]) {
      const result = run(home, [project, "--until", ...(value ? [value] : [])]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--until expects a valid date");
    }
  });

  it("resolves relative days and weeks to the end of the same UTC day", () => {
    const { home, project } = setup();
    const now = new Date();
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 6 * 864e5;
    for (const [id, timestamp] of [
      ["inside", new Date(day + 864e5 - 1).toISOString()],
      ["outside", new Date(day + 864e5).toISOString()],
    ]) {
      const records = fs.readFileSync("fixtures/basic.jsonl", "utf8").trim().split(/\r?\n/)
        .map(line => {
          const record = JSON.parse(line);
          record.sessionId = id;
          if (record.timestamp) record.timestamp = timestamp;
          return JSON.stringify(record);
        });
      fs.writeFileSync(path.join(project, `${id}.jsonl`), records.join("\n"));
    }
    for (const value of ["7d", "1w"]) {
      const inside = run(home, [path.join(project, "inside.jsonl"), "--until", value, "--json"]);
      const outside = run(home, [path.join(project, "outside.jsonl"), "--until", value, "--json"]);
      expect(inside.status).toBe(0);
      expect(outside.status).toBe(1);
    }
  });
});

it("applies --until before the budget check", () => {
  const { home, project } = setup();
  const single = run(home, [path.join(project, "before.jsonl"), "--json"]);
  const limit = JSON.parse(single.stdout).totalUSD * 1.1;
  expect(run(home, [project, "--budget", String(limit), "--json"]).status).toBe(2);
  const filtered = run(home, [project, "--until", "2026-09-30", "--budget", String(limit), "--json"]);
  expect(filtered.status).toBe(0);
});

it("ends a card's plan comparison at --until", () => {
  const { home, project } = setup();
  const out = path.join(home, "card.svg");
  const explicit = run(home, ["card", project, "--redact", "--plan", "30",
    "--since", "2026-09-30", "--until", "2026-09-30", "--out", out]);
  expect(explicit.status).toBe(0);
  expect(fs.readFileSync(out, "utf8")).toContain("($1.00)");
  const defaultWindow = run(home, ["card", project, "--redact", "--plan", "30",
    "--until", "2026-09-30", "--out", out]);
  expect(defaultWindow.status).toBe(0);
  expect(fs.readFileSync(out, "utf8")).toContain("($30.00)");
});
