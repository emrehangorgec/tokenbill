/**
 * Regenerate src/cost/prices.generated.ts from upstream pricing data.
 *
 * This is the ONLY part of the project that touches the network, and it never
 * ships: package.json's `files` field publishes `dist` only. Run it manually
 * with `npm run pricing:sync` when upstream prices change - tokenbill itself
 * still makes zero network calls at runtime.
 *
 * Sources
 *   1. LiteLLM's model_prices_and_context_window.json - machine-readable, and
 *      it carries everything the token math needs: per-token input/output
 *      rates plus the three cache costs the multipliers are derived from.
 *   2. src/cost/pricing.overrides.json - hand-curated facts the feed does not
 *      model: promotional date windows, fast mode, batch tier, retired models.
 *
 * Usage
 *   tsx scripts/sync-pricing.ts             sync and write the generated file
 *   tsx scripts/sync-pricing.ts --check     don't write; report whether rates changed
 *   tsx scripts/sync-pricing.ts --audit     offline: validate the shipped table's shape
 *                                           (lapsed or overlapping rate windows)
 *   tsx scripts/sync-pricing.ts --strict    treat override/feed mismatches as failure
 *
 * Exit codes
 *   0  up to date (or written successfully)
 *   1  rate data differs from the shipped table (--check), or audit failed
 *   3  could not fetch or parse the upstream feed
 *   4  hand-curated rate disagrees with the feed (--strict only)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OVERRIDES_PATH = path.join(ROOT, "src", "cost", "pricing.overrides.json");
const GENERATED_PATH = path.join(ROOT, "src", "cost", "prices.generated.ts");

const FEED_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const AUDIT = args.has("--audit");
const STRICT = args.has("--strict");

// --- shapes ----------------------------------------------------------------

interface ModelPrice {
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMult: number;
  cacheWrite5mMult: number;
  cacheWrite1hMult: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  fast?: { inputPerMTok: number; outputPerMTok: number };
  note?: string;
}

interface Table {
  asOf: string;
  source: string;
  models: ModelPrice[];
  serverTools: { webSearchPerRequest: number; webFetchPerRequest: number };
  batchMult: number;
}

// --- helpers ---------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Drop float noise from a derived ratio without hiding a real difference. */
function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function isComment(key: string): boolean {
  return key.startsWith("$");
}

function readOverrides(): any {
  const raw = fs.readFileSync(OVERRIDES_PATH, "utf8").replace(/^﻿/, "");
  return JSON.parse(raw);
}

function fail(code: number, msg: string): never {
  console.error(`sync-pricing: ${msg}`);
  process.exit(code);
}

// --- feed ------------------------------------------------------------------

interface FeedEntry {
  litellm_provider?: string;
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  search_context_cost_per_query?: Record<string, number>;
}

async function fetchFeed(): Promise<Record<string, FeedEntry>> {
  let res: Response;
  try {
    res = await fetch(FEED_URL, { headers: { accept: "application/json" } });
  } catch (e) {
    fail(3, `could not reach the pricing feed: ${(e as Error).message}`);
  }
  if (!res.ok) fail(3, `pricing feed returned HTTP ${res.status}`);
  try {
    return (await res.json()) as Record<string, FeedEntry>;
  } catch (e) {
    fail(3, `pricing feed is not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * First-party Anthropic chat models only. The feed keys the same model under
 * several providers (`anthropic/claude-opus-5`, `bedrock/anthropic.claude-opus-5`,
 * `vertex_ai/claude-opus-5`) at *different* prices - Bedrock and Vertex are
 * partner-operated and billed separately. Taking the wrong key silently prices
 * every session at a partner's rate.
 */
function isFirstPartyClaude(key: string, e: FeedEntry): boolean {
  if (key.includes("/")) return false;
  if (!key.startsWith("claude-")) return false;
  if (e.litellm_provider !== "anthropic") return false;
  if (e.mode && e.mode !== "chat") return false;
  return typeof e.input_cost_per_token === "number" && typeof e.output_cost_per_token === "number";
}

const DEFAULT_MULTS = { cacheReadMult: 0.1, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2 };

/**
 * Plausibility bounds for the derived cache multipliers. The feed is a
 * third-party aggregation and some older entries carry cache costs that are
 * not on the same scale as their base rate - claude-3-haiku-20240307 derives a
 * 1h write multiplier of 24x, claude-3-opus-20240229 derives 0.4x. Both are
 * impossible (a cache write is never cheaper than base input, and the 1h
 * premium is 2x), and either would badly distort a bill. Anything outside the
 * plausible band falls back to the published default and is reported.
 */
const MULT_BOUNDS = {
  cacheReadMult: [0.05, 0.5],
  cacheWrite5mMult: [1, 1.75],
  cacheWrite1hMult: [1.5, 3],
} as const;

function deriveModel(key: string, e: FeedEntry, notes: string[]): ModelPrice {
  const inTok = e.input_cost_per_token as number;
  const mult = (
    cost: number | undefined,
    fallback: number,
    label: string,
    bounds: readonly [number, number],
  ): number => {
    if (typeof cost !== "number" || inTok <= 0) {
      notes.push(`${key}: no ${label} in feed, kept default ${fallback}`);
      return fallback;
    }
    const derived = round(cost / inTok, 4);
    if (derived < bounds[0] || derived > bounds[1]) {
      notes.push(
        `${key}: feed implies ${label} of ${derived}x, outside plausible ` +
          `${bounds[0]}-${bounds[1]}x - kept default ${fallback}`,
      );
      return fallback;
    }
    return derived;
  };
  return {
    match: key,
    inputPerMTok: round(inTok * 1e6),
    outputPerMTok: round((e.output_cost_per_token as number) * 1e6),
    cacheReadMult: mult(
      e.cache_read_input_token_cost,
      DEFAULT_MULTS.cacheReadMult,
      "cache read cost",
      MULT_BOUNDS.cacheReadMult,
    ),
    cacheWrite5mMult: mult(
      e.cache_creation_input_token_cost,
      DEFAULT_MULTS.cacheWrite5mMult,
      "5m cache write cost",
      MULT_BOUNDS.cacheWrite5mMult,
    ),
    cacheWrite1hMult: mult(
      e.cache_creation_input_token_cost_above_1hr,
      DEFAULT_MULTS.cacheWrite1hMult,
      "1h cache write cost",
      MULT_BOUNDS.cacheWrite1hMult,
    ),
  };
}

/** Web search is billed per query and is model-independent; take the modal value. */
function deriveWebSearch(feed: Record<string, FeedEntry>, fallback: number): number {
  const counts = new Map<number, number>();
  for (const [key, e] of Object.entries(feed)) {
    if (!isFirstPartyClaude(key, e)) continue;
    const q = e.search_context_cost_per_query;
    if (!q) continue;
    for (const v of Object.values(q)) {
      if (typeof v === "number") counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  let best: number | undefined;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) ((best = v), (bestN = n));
  return best ?? fallback;
}

// --- merge -----------------------------------------------------------------

function buildModels(feed: Record<string, FeedEntry>, ov: any, notes: string[], mismatches: string[]) {
  const dropKeys: Set<string> = new Set(ov.drop?.keys ?? []);
  const windows: Record<string, any[]> = ov.windows ?? {};
  const fast: Record<string, any> = ov.fast ?? {};
  const manual: Record<string, any> = ov.models ?? {};

  const models: ModelPrice[] = [];
  const seen = new Set<string>();

  for (const [key, e] of Object.entries(feed)) {
    if (isComment(key) || dropKeys.has(key) || !isFirstPartyClaude(key, e)) continue;
    const derived = deriveModel(key, e, notes);
    seen.add(key);

    // Hand-entered rate for this model: cross-check, then let the override win.
    const hand = manual[key];
    if (hand && !isComment(key)) {
      if (
        hand.verify &&
        (round(hand.inputPerMTok) !== derived.inputPerMTok ||
          round(hand.outputPerMTok) !== derived.outputPerMTok)
      ) {
        mismatches.push(
          `${key}: overrides say $${hand.inputPerMTok}/$${hand.outputPerMTok}, ` +
            `feed says $${derived.inputPerMTok}/$${derived.outputPerMTok}`,
        );
      }
      derived.inputPerMTok = round(hand.inputPerMTok ?? derived.inputPerMTok);
      derived.outputPerMTok = round(hand.outputPerMTok ?? derived.outputPerMTok);
      if (hand.note) derived.note = hand.note;
    }

    if (fast[key] && !isComment(key)) {
      derived.fast = {
        inputPerMTok: round(fast[key].inputPerMTok),
        outputPerMTok: round(fast[key].outputPerMTok),
      };
    }

    // A declared window set replaces the feed's single undated rate: the feed
    // only ever reports today's price, so a promo boundary is invisible to it.
    const win = windows[key];
    if (Array.isArray(win) && win.length > 0) {
      for (const w of win) {
        models.push({
          ...derived,
          inputPerMTok: round(w.inputPerMTok ?? derived.inputPerMTok),
          outputPerMTok: round(w.outputPerMTok ?? derived.outputPerMTok),
          effectiveFrom: w.effectiveFrom,
          effectiveTo: w.effectiveTo,
          note: w.note ?? derived.note,
        });
      }
    } else {
      models.push(derived);
    }
  }

  // Retired models the feed no longer carries: their rates are frozen, so the
  // hand-curated entry is authoritative.
  for (const [key, hand] of Object.entries(manual)) {
    if (isComment(key) || seen.has(key) || dropKeys.has(key)) continue;
    models.push({
      match: key,
      inputPerMTok: round((hand as any).inputPerMTok),
      outputPerMTok: round((hand as any).outputPerMTok),
      ...DEFAULT_MULTS,
      note: (hand as any).note ?? "retired model, rate frozen",
    });
    notes.push(`${key}: not in feed, using hand-curated frozen rate`);
  }

  models.sort(
    (a, b) =>
      a.match.localeCompare(b.match) || (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? ""),
  );
  return models;
}

// --- emit ------------------------------------------------------------------

const HEADER = `// ---------------------------------------------------------------------------
// AUTO-GENERATED - DO NOT EDIT BY HAND.
//
// Regenerate with:  npm run pricing:sync
// Generator:        scripts/sync-pricing.ts
// Machine source:   LiteLLM model_prices_and_context_window.json
//                   (first-party \`anthropic\` provider entries only)
// Hand-curated:     src/cost/pricing.overrides.json - dimensions the feed does
//                   not model: promo windows, fast mode, batch tier, retired
//                   models.
//
// \`asOf\` is the day the rates below last changed (printed in reports).
//
// Regenerate manually with \`npm run pricing:sync\`; tokenbill makes no network
// calls at runtime.
// ---------------------------------------------------------------------------
`;

function emitModel(m: ModelPrice): string {
  const parts = [
    `match: ${JSON.stringify(m.match)}`,
    `inputPerMTok: ${m.inputPerMTok}`,
    `outputPerMTok: ${m.outputPerMTok}`,
    `cacheReadMult: ${m.cacheReadMult}`,
    `cacheWrite5mMult: ${m.cacheWrite5mMult}`,
    `cacheWrite1hMult: ${m.cacheWrite1hMult}`,
  ];
  if (m.effectiveFrom) parts.push(`effectiveFrom: ${JSON.stringify(m.effectiveFrom)}`);
  if (m.effectiveTo) parts.push(`effectiveTo: ${JSON.stringify(m.effectiveTo)}`);
  if (m.fast) {
    parts.push(`fast: { inputPerMTok: ${m.fast.inputPerMTok}, outputPerMTok: ${m.fast.outputPerMTok} }`);
  }
  if (m.note) parts.push(`note: ${JSON.stringify(m.note)}`);
  return `    { ${parts.join(", ")} },`;
}

function emit(t: Table): string {
  return (
    HEADER +
    `import type { PriceTable } from "./pricing.js";\n\n` +
    `export const GENERATED_PRICES: PriceTable = {\n` +
    `  asOf: ${JSON.stringify(t.asOf)},\n` +
    `  source: ${JSON.stringify(t.source)},\n` +
    `  batchMult: ${t.batchMult},\n` +
    `  serverTools: { webSearchPerRequest: ${t.serverTools.webSearchPerRequest}, ` +
    `webFetchPerRequest: ${t.serverTools.webFetchPerRequest} },\n` +
    `  models: [\n${t.models.map(emitModel).join("\n")}\n  ],\n` +
    `};\n`
  );
}

/** Everything except the as-of date - what a "did the rates change" diff compares. */
function rateFingerprint(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*asOf:/.test(l))
    .join("\n");
}

// --- audit (offline) -------------------------------------------------------

async function audit(): Promise<never> {
  const { GENERATED_PRICES } = await import("../src/cost/prices.generated.js");
  const t = GENERATED_PRICES as Table;
  const problems: string[] = [];
  const day = today();

  const byMatch = new Map<string, ModelPrice[]>();
  for (const m of t.models) {
    const rows = byMatch.get(m.match) ?? [];
    rows.push(m);
    byMatch.set(m.match, rows);
  }

  for (const [match, rows] of byMatch) {
    const active = rows.filter(
      (r) => !(r.effectiveFrom && day < r.effectiveFrom) && !(r.effectiveTo && day > r.effectiveTo),
    );
    if (active.length === 0) {
      problems.push(`${match}: every rate window has lapsed - no rate applies today`);
    }
    if (active.length > 1) {
      problems.push(`${match}: ${active.length} rate windows overlap today - lookup is ambiguous`);
    }
  }

  if (problems.length > 0) {
    console.error("sync-pricing --audit: price table needs attention");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`sync-pricing --audit: ok (${t.models.length} rates, asOf ${t.asOf})`);
  process.exit(0);
}

// --- main ------------------------------------------------------------------

async function main(): Promise<void> {
  if (AUDIT) await audit();

  const ov = readOverrides();
  const feed = await fetchFeed();
  const notes: string[] = [];
  const mismatches: string[] = [];

  const models = buildModels(feed, ov, notes, mismatches);
  if (models.length === 0) fail(3, "feed produced no first-party Anthropic models - refusing to write");

  const existing = fs.existsSync(GENERATED_PATH) ? fs.readFileSync(GENERATED_PATH, "utf8") : "";
  const prevAsOf = /asOf: "([\d-]+)"/.exec(existing)?.[1];

  const candidate: Table = {
    asOf: prevAsOf ?? today(),
    source: "litellm@main + pricing.overrides.json",
    models,
    serverTools: {
      webSearchPerRequest: deriveWebSearch(feed, 0.01),
      webFetchPerRequest: 0,
    },
    batchMult: typeof ov.batchMult === "number" ? ov.batchMult : 0.5,
  };

  const ratesChanged = rateFingerprint(emit(candidate)) !== rateFingerprint(existing);
  if (ratesChanged) candidate.asOf = today();
  const next = emit(candidate);

  for (const n of notes) console.log(`  note: ${n}`);
  for (const m of mismatches) console.warn(`  MISMATCH ${m}`);

  console.log(
    `sync-pricing: ${models.length} rates from ${Object.keys(feed).length} feed entries; ` +
      `rates ${ratesChanged ? "CHANGED" : "unchanged"}`,
  );

  if (CHECK) {
    if (mismatches.length > 0 && STRICT) process.exit(4);
    process.exit(ratesChanged ? 1 : 0);
  }

  fs.writeFileSync(GENERATED_PATH, next);
  console.log(`sync-pricing: wrote ${path.relative(ROOT, GENERATED_PATH)}`);
  if (mismatches.length > 0 && STRICT) process.exit(4);
}

await main();
