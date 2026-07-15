#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aggregate } from "./aggregate.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { attribute } from "./attribute.js";
import { analyzeCache } from "./cost/cache.js";
import { calculate } from "./cost/calculator.js";
import { overridePricing } from "./cost/pricing.js";
import { claudeProjectsRoot, resolveProjectLogDir } from "./project-dir.js";
import { renderAggregateJson, renderJson } from "./report/json.js";
import { renderAggregateReport, renderReport } from "./report/terminal.js";
import { setColorEnabled } from "./report/theme.js";
import { topTurns } from "./turns.js";

const HELP = `Usage: tokenbill [options] [session-file.jsonl | project-dir]

With no path argument, analyzes every session in the Claude Code project
matching your current directory (falls back to your single most recent
session anywhere if the current directory isn't a recognized project).
A directory argument (a project's own source folder or its
~/.claude/projects/<encoded> log folder) analyzes every session in it.
A single .jsonl file gives the full detailed report for just that session.

Options:
  --json            machine-readable output
  --top <n>         number of expensive turns to show (default 10)
  --pricing <file>  JSON file overriding the built-in price table
  --no-color        disable colored output (NO_COLOR env also respected)
  -h, --help        show this help`;

function findSessionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
}

/** No-arg default: newest session file across all projects. */
function newestSessionOverall(): string | undefined {
  const root = claudeProjectsRoot();
  if (!fs.existsSync(root)) return undefined;
  let best: { file: string; mtime: number } | undefined;
  for (const proj of fs.readdirSync(root)) {
    for (const f of findSessionFiles(path.join(root, proj))) {
      const mtime = fs.statSync(f).mtimeMs;
      if (!best || mtime > best.mtime) best = { file: f, mtime };
    }
  }
  return best?.file;
}

type Target =
  | { mode: "single"; file: string }
  | { mode: "aggregate"; files: string[]; label: string };

function resolveTarget(arg: string | undefined): Target {
  if (!arg) {
    const projectDir = resolveProjectLogDir(process.cwd());
    const files = projectDir ? findSessionFiles(projectDir) : [];
    if (projectDir && files.length > 0) {
      return { mode: "aggregate", files, label: projectDir };
    }
    const f = newestSessionOverall();
    if (!f) {
      console.error("No Claude Code sessions found under ~/.claude/projects");
      process.exit(1);
    }
    if (projectDir) {
      console.error(`Note: no sessions in ${projectDir} yet - showing your most recent session overall.\n`);
    } else {
      console.error(
        `Note: ${process.cwd()} isn't a recognized Claude Code project directory - showing your most recent session overall.\n`,
      );
    }
    return { mode: "single", file: f };
  }

  const p = path.resolve(arg);
  if (!fs.existsSync(p)) {
    console.error(`Not found: ${p}`);
    process.exit(1);
  }
  if (fs.statSync(p).isFile()) {
    return { mode: "single", file: p };
  }

  // Directory: try it directly, then try mapping it as a project source dir
  // to its corresponding ~/.claude/projects/<encoded> log directory.
  let files = findSessionFiles(p);
  let label = p;
  if (files.length === 0) {
    const mapped = resolveProjectLogDir(p);
    if (mapped) {
      const mappedFiles = findSessionFiles(mapped);
      if (mappedFiles.length > 0) {
        console.error(`Note: mapped project directory to its Claude Code logs at ${mapped}\n`);
        files = mappedFiles;
        label = mapped;
      }
    }
  }
  if (files.length === 0) {
    console.error(`No .jsonl session files in ${p} (or its mapped Claude Code project log directory)`);
    process.exit(1);
  }
  return { mode: "aggregate", files, label };
}

// --- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
let json = false;
let top = 10;
let target: string | undefined;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    console.log(HELP);
    process.exit(0);
  } else if (a === "--json") {
    json = true;
  } else if (a === "--no-color") {
    setColorEnabled(false);
  } else if (a === "--top") {
    top = Number(argv[++i]);
    if (!Number.isInteger(top) || top < 1) {
      console.error("--top expects a positive integer");
      process.exit(1);
    }
  } else if (a === "--pricing") {
    const file = argv[++i];
    if (!file || !fs.existsSync(file)) {
      console.error("--pricing expects a JSON file path");
      process.exit(1);
    }
    try {
      overridePricing(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) {
      console.error(`Invalid pricing file: ${(e as Error).message}`);
      process.exit(1);
    }
  } else if (a.startsWith("-")) {
    console.error(`Unknown option: ${a}\n\n${HELP}`);
    process.exit(1);
  } else {
    target = a;
  }
}

const resolved = resolveTarget(target);

if (resolved.mode === "single") {
  const session = claudeCodeAdapter.parse(resolved.file);
  const cost = calculate(session);
  const attr = attribute(session);
  const turns = topTurns(session, top);
  const cache = analyzeCache(session);
  console.log(
    json
      ? renderJson(session, cost, attr, turns, cache)
      : renderReport(session, cost, attr, turns, cache),
  );
} else {
  const sessions = resolved.files.map((f) => claudeCodeAdapter.parse(f));
  const result = aggregate(sessions, top);
  console.log(
    json
      ? renderAggregateJson(result, resolved.label)
      : renderAggregateReport(result, resolved.label, top),
  );
}
