#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aggregate } from "./aggregate.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { attribute } from "./attribute.js";
import { analyzeCache } from "./cost/cache.js";
import { calculate } from "./cost/calculator.js";
import { overridePricing, overrideServerToolPricing } from "./cost/pricing.js";
import {
  allProjectSessionFiles,
  claudeProjectsRoot,
  encodeProjectPath,
  projectName,
  resolveProjectLogDir,
} from "./project-dir.js";
import { svgToPng } from "./card-png.js";
import { setShowPrompts } from "./privacy.js";
import { cardCaption, cardData, PLANS, renderCardSvg, type PlanInfo } from "./report/card.js";
import { renderAggregateHtml, renderHtml } from "./report/html.js";
import { renderAggregateJson, renderJson } from "./report/json.js";
import { renderAggregateMarkdown, renderMarkdown } from "./report/markdown.js";
import { renderAggregateReport, renderReport } from "./report/terminal.js";
import { setColorEnabled } from "./report/theme.js";
import { runStatusline } from "./statusline.js";
import { topTurns } from "./turns.js";

const HELP = `Usage: tokenbill [options] [session-file.jsonl | project-dir]
       tokenbill card [options] [project-dir]   (shareable PNG of where the money went)
       tokenbill statusline   (Claude Code statusLine command, reads JSON on stdin)

With no path argument, analyzes every session in the Claude Code project
matching your current directory (falls back to your single most recent
session anywhere if the current directory isn't a recognized project).
A directory argument (a project's own source folder or its
~/.claude/projects/<encoded> log folder) analyzes every session in it.
A single .jsonl file gives the full detailed report for just that session.

Options:
  --all             analyze sessions across every Claude Code project
                    (cannot be combined with a session or project path)
  --since <date>    include sessions starting on or after YYYY-MM-DD (UTC),
                    or a relative duration: 7d (last 7 days) or 2w (last 2 weeks)
  --json            machine-readable output
  --html [file]     write a shareable single-file HTML report
                    (default: tokenbill-report.html)
  --md [file]       GitHub Markdown report, to stdout or a .md file
                    (PR comments, $GITHUB_STEP_SUMMARY)
  --top <n>         number of expensive turns to show (default 10)
  --budget <usd>    exit 2 if the reported total exceeds this amount (for CI)
  --pricing <file>  JSON file overriding the built-in price table
  --redact          hide your prompt text (turns show tool activity instead)
  --no-color        disable colored output (NO_COLOR env also respected)
  -h, --help        show this help

Card options:
  --plan <plan>     pro, max5, max20 or a monthly USD amount: adds the
                    "N× my plan" figure (last 30 days unless --since is set)
  --out <file>      output path, .png or .svg (default: tokenbill-card.png)

Exit codes: 0 ok, 1 error, 2 budget exceeded.`;

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

function resolveTarget(arg: string | undefined, all: boolean): Target {
  if (all) {
    const files = allProjectSessionFiles();
    if (files.length === 0) {
      throw new Error("No Claude Code sessions found under ~/.claude/projects");
    }
    return { mode: "aggregate", files, label: "All projects" };
  }
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

// --- statusline subcommand ------------------------------------------------
// Claude Code renders ANSI colors in the status line even though stdout is a
// pipe, so colors stay on unless explicitly disabled.
if (process.argv[2] === "statusline") {
  setColorEnabled(!process.env.NO_COLOR && !process.argv.includes("--no-color"));
  let raw = "";
  try {
    raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
  } catch {
    /* no stdin */
  }
  console.log(runStatusline(raw));
  process.exit(0);
}

// --- arg parsing -----------------------------------------------------------
const card = process.argv[2] === "card";
const argv = process.argv.slice(card ? 3 : 2);
let json = false;
let all = false;
let html: string | undefined;
let md: string | true | undefined;
let top = 10;
let budget: number | undefined;
let target: string | undefined;
let since: string | undefined;
let planArg: string | undefined;
let cardOut = path.resolve("tokenbill-card.png");

/**
 * --pricing accepts either the bare model array (original format) or an object
 * `{ models?: [...], serverTools?: {...} }` so per-request tool prices can be
 * overridden too.
 */
function applyPricingFile(parsed: unknown): void {
  if (Array.isArray(parsed)) {
    overridePricing(parsed);
    return;
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as { models?: unknown; serverTools?: unknown };
    if (Array.isArray(o.models)) overridePricing(o.models);
    if (o.serverTools && typeof o.serverTools === "object") {
      overrideServerToolPricing(o.serverTools);
    }
    if (!o.models && !o.serverTools) {
      throw new Error("expected an array of model prices, or { models, serverTools }");
    }
    return;
  }
  throw new Error("expected an array of model prices, or { models, serverTools }");
}

/**
 * --since takes an absolute YYYY-MM-DD or a relative duration (`7d`, `2w`).
 * A relative duration resolves to the UTC date `n` units ago, inclusive of
 * today - `7d` covers today and the previous 6 days. Returns undefined for
 * anything invalid, including `0d` and malformed suffixes.
 */
function resolveSince(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const relative = /^([1-9]\d*)([dw])$/.exec(raw);
  if (relative) {
    const days = Number(relative[1]) * (relative[2] === "w" ? 7 : 1);
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    // Durations past JavaScript's date range would throw in toISOString.
    const start = new Date(todayUTC - (days - 1) * 864e5);
    return isNaN(start.getTime()) ? undefined : start.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const time = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw ? raw : undefined;
}

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    console.log(HELP);
    process.exit(0);
  } else if (a === "--json") {
    json = true;
  } else if (a === "--all") {
    all = true;
  } else if (a === "--since") {
    const raw = argv[++i];
    const resolved = resolveSince(raw);
    if (resolved === undefined) {
      console.error(
        "--since expects a valid date in YYYY-MM-DD format (UTC), or a relative duration like 7d or 2w",
      );
      process.exit(1);
    }
    since = resolved;
  } else if (a === "--html") {
    html =
      argv[i + 1] && argv[i + 1].endsWith(".html") ? path.resolve(argv[++i]) : path.resolve("tokenbill-report.html");
  } else if (a === "--md") {
    md = argv[i + 1] && argv[i + 1].endsWith(".md") ? path.resolve(argv[++i]) : true;
  } else if (a === "--redact") {
    setShowPrompts(false);
  } else if (card && a === "--plan") {
    planArg = argv[++i];
    if (!planArg || !(planArg in PLANS || Number(planArg) > 0)) {
      console.error("--plan expects pro, max5, max20 or a monthly USD amount");
      process.exit(1);
    }
  } else if (card && a === "--out") {
    const out = argv[++i];
    if (!out || !/\.(png|svg)$/i.test(out)) {
      console.error("--out expects a .png or .svg file path");
      process.exit(1);
    }
    cardOut = path.resolve(out);
  } else if (a === "--no-color") {
    setColorEnabled(false);
  } else if (a === "--top") {
    top = Number(argv[++i]);
    if (!Number.isInteger(top) || top < 1) {
      console.error("--top expects a positive integer");
      process.exit(1);
    }
  } else if (a === "--budget") {
    budget = Number(argv[++i]);
    if (!Number.isFinite(budget) || budget < 0) {
      console.error("--budget expects a non-negative dollar amount");
      process.exit(1);
    }
  } else if (a === "--pricing") {
    const file = argv[++i];
    if (!file || !fs.existsSync(file)) {
      console.error("--pricing expects a JSON file path");
      process.exit(1);
    }
    try {
      // Strip a UTF-8 BOM: Windows editors and PowerShell add one, and
      // JSON.parse rejects it.
      applyPricingFile(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")));
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

/**
 * Mask the home directory in displayed labels so reports are shareable.
 * Covers both the literal path and its encoded form inside a
 * ~/.claude/projects/<encoded> folder name.
 */
function maskLabel(label: string): string {
  const home = os.homedir();
  let masked = label.startsWith(home) ? `~${label.slice(home.length)}` : label;
  const encodedHome = encodeProjectPath(home);
  while (masked.includes(encodedHome)) masked = masked.replace(encodedHome, "~");
  return masked;
}

if (card && (json || html || md || budget !== undefined)) {
  console.error("card cannot be combined with --json, --html, --md or --budget");
  process.exit(1);
}

/**
 * The plan fee over the card's window. Without --since the card covers the
 * last 30 days and compares against one month's fee.
 */
function resolvePlan(): PlanInfo | undefined {
  if (!planArg) return undefined;
  const known = PLANS[planArg];
  const monthly = known ? known.monthlyUSD : Number(planArg);
  const name = known ? known.name : `$${monthly}/mo`;
  if (!since || planWindowDefault) return { name, feeUSD: monthly, windowDays: 30 };
  const days = Math.max(1, Math.ceil((Date.now() - Date.parse(`${since}T00:00:00.000Z`)) / 864e5));
  return { name, feeUSD: (monthly * days) / 30, windowDays: days };
}
const planWindowDefault = card && !!planArg && !since;
if (planWindowDefault) {
  since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
}

function writeCard(result: ReturnType<typeof aggregate>, project: string): void {
  const data = cardData(result, project, resolvePlan());
  const svg = renderCardSvg(data);
  let out = cardOut;
  if (out.toLowerCase().endsWith(".png")) {
    const png = svgToPng(svg);
    if (png) {
      fs.writeFileSync(out, png);
    } else {
      out = out.replace(/\.png$/i, ".svg");
      fs.writeFileSync(out, svg);
      console.error("PNG renderer unavailable on this platform - wrote SVG instead.");
    }
  } else {
    fs.writeFileSync(out, svg);
  }
  console.error(`Wrote ${out}\n`);
  if (!planArg) {
    console.error("Tip: add --plan pro, max5 or max20 to compare against your subscription.\n");
  }
  console.log(cardCaption(data));
}

if ([json, html, md].filter(Boolean).length > 1) {
  console.error("--json, --html and --md are mutually exclusive");
  process.exit(1);
}

if (all && target !== undefined) {
  console.error("--all cannot be combined with a session or project path");
  process.exit(1);
}

/** --md goes to stdout unless a .md file was named. */
function emitMarkdown(text: string): void {
  if (typeof md === "string") {
    fs.writeFileSync(md, text);
    console.error(`Wrote ${md}`);
  } else {
    console.log(text);
  }
}

let totalUSD = 0;

try {
  const resolved = resolveTarget(target, all);
  // Filter whole sessions by their recorded start, never by file modification time.
  const cutoff = since ? Date.parse(`${since}T00:00:00.000Z`) : undefined;
  const matchesSince = (session: ReturnType<typeof claudeCodeAdapter.parse>): boolean =>
    cutoff === undefined || (session.startTime !== undefined && Date.parse(session.startTime) >= cutoff);
  const noMatches = () => new Error(`No sessions starting on or after ${since} (UTC)`);

  if (resolved.mode === "single") {
    const session = claudeCodeAdapter.parse(resolved.file);
    if (!matchesSince(session)) throw noMatches();
    const cost = calculate(session);
    const attr = attribute(session);
    const turns = topTurns(session, top);
    const cache = analyzeCache(session);
    totalUSD = cost.totalUSD;
    if (card) {
      writeCard(aggregate([session], top), projectName([session.cwd]) ?? session.sessionId.slice(0, 8));
    } else if (html) {
      fs.writeFileSync(html, renderHtml(session, cost, attr, turns, cache));
      console.error(`Wrote ${html}`);
    } else if (md) {
      emitMarkdown(renderMarkdown(session, cost, attr, turns, cache));
    } else {
      console.log(
        json
          ? renderJson(session, cost, attr, turns, cache)
          : renderReport(session, cost, attr, turns, cache),
      );
    }
  } else {
    const sessions = resolved.files.map((f) => claudeCodeAdapter.parse(f)).filter(matchesSince);
    if (since && sessions.length === 0) throw noMatches();
    const result = aggregate(sessions, top);
    const label = all
      ? resolved.label
      : (projectName(sessions.map((s) => s.cwd)) ?? maskLabel(resolved.label));
    totalUSD = result.totalUSD;
    if (card) {
      writeCard(result, all ? "all my projects" : label);
    } else if (html) {
      fs.writeFileSync(html, renderAggregateHtml(result, label));
      console.error(`Wrote ${html}`);
    } else if (md) {
      emitMarkdown(renderAggregateMarkdown(result, label));
    } else {
      console.log(
        json ? renderAggregateJson(result, label) : renderAggregateReport(result, label, top),
      );
    }
  }
} catch (e) {
  console.error(`tokenbill: ${(e as Error).message}`);
  process.exit(1);
}

// Budget guard runs after the report so CI keeps the output and still fails.
if (budget !== undefined && totalUSD > budget) {
  console.error(
    `tokenbill: spend $${totalUSD.toFixed(2)} exceeds budget $${budget.toFixed(2)}`,
  );
  process.exit(2);
}
