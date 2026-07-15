/**
 * Renders a tokenbill report as a dark-terminal SVG at assets/demo.svg.
 * Dev-only, zero dependencies.
 *
 *   npm run demo                       # from fixtures/basic.jsonl
 *   npm run demo -- <file-or-dir>      # single session, or aggregate of a
 *                                      # directory of .jsonl session files
 *   npm run demo -- <dir> "<label>"    # override the project label shown
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { aggregate } from "../src/aggregate.js";
import { attribute } from "../src/attribute.js";
import { analyzeCache } from "../src/cost/cache.js";
import { calculate } from "../src/cost/calculator.js";
import { renderAggregateReport, renderReport } from "../src/report/terminal.js";
import { setColorEnabled } from "../src/report/theme.js";
import { topTurns } from "../src/turns.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? path.join(root, "fixtures", "basic.jsonl");
const labelOverride = process.argv[3];
const outFile = path.join(root, "assets", "demo.svg");

setColorEnabled(true);
let ansi: string;
if (fs.statSync(target).isDirectory()) {
  const files = fs
    .readdirSync(target)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(target, f));
  const sessions = files.map((f) => claudeCodeAdapter.parse(f));
  const result = aggregate(sessions, 5);
  ansi = renderAggregateReport(result, labelOverride ?? target, 5);
} else {
  const session = claudeCodeAdapter.parse(target);
  ansi = renderReport(session, calculate(session), attribute(session), topTurns(session, 3), analyzeCache(session));
}

// --- minimal ANSI-to-SVG conversion -----------------------------------------

// xterm 256-color values used by src/report/theme.ts palette.
const XTERM: Record<number, string> = {
  45: "#00d7ff",
  75: "#5fafff",
  78: "#5fd787",
  80: "#5fd7d7",
  170: "#d75fd7",
  179: "#d7af5f",
  203: "#ff5f5f",
  214: "#ffaf00",
  245: "#8a8a8a",
};

const FG_DEFAULT = "#d4d4d4";
const FG_DIM = "#6e7681";
const BG = "#0d1117";
const CHROME = "#161b22";

interface Span {
  text: string;
  color: string;
  bold: boolean;
}

function parseAnsiLine(line: string): Span[] {
  const spans: Span[] = [];
  let color = FG_DEFAULT;
  let boldOn = false;
  let dimOn = false;
  let buf = "";
  const flush = () => {
    if (buf) spans.push({ text: buf, color: dimOn ? FG_DIM : color, bold: boldOn });
    buf = "";
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    buf += line.slice(last, m.index);
    last = re.lastIndex;
    flush();
    const codes = m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        color = FG_DEFAULT;
        boldOn = false;
        dimOn = false;
      } else if (c === 1) boldOn = true;
      else if (c === 2) dimOn = true;
      else if (c === 22) {
        boldOn = false;
        dimOn = false;
      } else if (c === 38 && codes[i + 1] === 5) {
        color = XTERM[codes[i + 2]] ?? FG_DEFAULT;
        i += 2;
      }
    }
  }
  buf += line.slice(last);
  flush();
  return spans;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const lines = ansi.replace(/\n+$/, "").split("\n");
const CHAR_W = 8.4;
const LINE_H = 21;
const PAD = 20;
const HEADER_H = 36;
const maxCols = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length));
const width = Math.ceil(maxCols * CHAR_W + PAD * 2);
const height = HEADER_H + lines.length * LINE_H + PAD;

const rows: string[] = [];
lines.forEach((line, i) => {
  const y = HEADER_H + PAD / 2 + (i + 0.75) * LINE_H;
  let col = 0;
  const parts: string[] = [];
  for (const span of parseAnsiLine(line)) {
    if (span.text.length > 0) {
      const x = PAD + col * CHAR_W;
      parts.push(
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${span.color}"` +
          (span.bold ? ` font-weight="bold"` : "") +
          ` xml:space="preserve">${esc(span.text)}</text>`,
      );
      col += span.text.length;
    }
  }
  rows.push(parts.join(""));
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Cascadia Code','SF Mono',Consolas,Menlo,monospace" font-size="14">
  <rect width="${width}" height="${height}" rx="10" fill="${BG}"/>
  <rect width="${width}" height="${HEADER_H}" rx="10" fill="${CHROME}"/>
  <rect y="${HEADER_H - 10}" width="${width}" height="10" fill="${CHROME}"/>
  <circle cx="22" cy="${HEADER_H / 2}" r="6" fill="#ff5f57"/>
  <circle cx="44" cy="${HEADER_H / 2}" r="6" fill="#febc2e"/>
  <circle cx="66" cy="${HEADER_H / 2}" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="${HEADER_H / 2 + 5}" fill="${FG_DIM}" text-anchor="middle" font-size="13">npx tokenbill</text>
${rows.map((r) => "  " + r).join("\n")}
</svg>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, svg);
console.log(`Wrote ${outFile} (${lines.length} lines, ${width}x${height})`);
