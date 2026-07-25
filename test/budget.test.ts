import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Run tsx's entry point directly under the current node binary: spawning the
// `npx`/`tsx` shell shims is unreliable on Windows (exit status comes back null).
// `tsx`'s exports map blocks deep imports, so resolve its package root instead.
const require_ = createRequire(import.meta.url);
const TSX_CLI = path.join(path.dirname(require_.resolve("tsx/package.json")), "dist/cli.mjs");

/** Run the CLI and report exit code + captured output. */
function run(args: string[]) {
  const r = spawnSync(process.execPath, [TSX_CLI, "src/cli.ts", ...args], {
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("--budget", () => {
  it("exits 2 and explains when spend exceeds the budget", () => {
    const r = run(["fixtures/basic.jsonl", "--budget", "0", "--no-color"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/exceeds budget/);
    // The report is still printed, so CI keeps the diagnostic output.
    expect(r.stdout).toMatch(/TOTAL ESTIMATED COST/);
  });

  it("exits 0 when spend is within the budget", () => {
    const r = run(["fixtures/basic.jsonl", "--budget", "9999", "--no-color"]);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/exceeds budget/);
  });

  it("rejects a non-numeric budget", () => {
    const r = run(["fixtures/basic.jsonl", "--budget", "abc"]);
    expect(r.code).toBe(1);
  });
}, 60_000);
