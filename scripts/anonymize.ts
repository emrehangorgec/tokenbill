/**
 * Turn a real Claude Code session log into a committable fixture:
 * replace all string *content* with same-length placeholder text (preserving
 * token-relevant sizes), keep structure, usage numbers, timestamps, models,
 * record types, and tool names intact.
 *
 * Usage: tsx scripts/anonymize.ts <in.jsonl> <out.jsonl>
 */
import fs from "node:fs";

const KEEP_KEYS = new Set([
  "type", "subtype", "model", "role", "name", "id", "uuid", "parentUuid",
  "sessionId", "requestId", "promptId", "timestamp", "version", "userType",
  "entrypoint", "stop_reason", "stopReason", "service_tier", "speed",
  "inference_geo", "leafUuid", "toolUseID", "tool_use_id", "sourceToolAssistantUUID",
  "isSidechain", "permissionMode", "operation",
]);

function scrub(text: string): string {
  // Same length, no real content. Keep newlines so line structure survives.
  return text.replace(/[^\n]/g, (ch, i) => "abcdefghij"[i % 10] ?? "x");
}

function walk(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && KEEP_KEYS.has(key)) return value;
    return scrub(value);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // usage objects are all numbers - copied through automatically
      out[k] = walk(v, k);
    }
    return out;
  }
  return value; // numbers, booleans, null
}

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error("Usage: tsx scripts/anonymize.ts <in.jsonl> <out.jsonl>");
  process.exit(1);
}

const out: string[] = [];
for (const line of fs.readFileSync(inFile, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    out.push(JSON.stringify(walk(JSON.parse(line))));
  } catch {
    out.push(line); // keep corrupt lines corrupt - useful for tests
  }
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`Wrote ${out.length} lines to ${outFile}`);
