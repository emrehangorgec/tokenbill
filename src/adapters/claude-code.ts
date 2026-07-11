import fs from "node:fs";
import path from "node:path";
import type {
  Adapter,
  NormalizedRequest,
  NormalizedSession,
  Stream,
  TimelineEvent,
  Usage,
} from "./types.js";

const IGNORED_TYPES = new Set([
  "ai-title",
  "queue-operation",
  "attachment",
  "last-prompt",
  "progress",
]);

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function toUsage(raw: any): Usage {
  return {
    input_tokens: num(raw.input_tokens),
    output_tokens: num(raw.output_tokens),
    cache_read_input_tokens: num(raw.cache_read_input_tokens),
    cache_creation_input_tokens: num(raw.cache_creation_input_tokens),
    cache_creation: raw.cache_creation
      ? {
          ephemeral_5m_input_tokens: num(raw.cache_creation.ephemeral_5m_input_tokens),
          ephemeral_1h_input_tokens: num(raw.cache_creation.ephemeral_1h_input_tokens),
        }
      : undefined,
    server_tool_use: raw.server_tool_use
      ? {
          web_search_requests: num(raw.server_tool_use.web_search_requests),
          web_fetch_requests: num(raw.server_tool_use.web_fetch_requests),
        }
      : undefined,
  };
}

/** iterations are informational - top-level usage is already the total. Warn if that invariant breaks. */
function checkIterations(rawUsage: any, warnings: string[], requestId: string): void {
  const iters = rawUsage.iterations;
  if (!Array.isArray(iters) || iters.length === 0) return;
  const sum = (field: string) => iters.reduce((a: number, it: any) => a + num(it?.[field]), 0);
  if (
    sum("output_tokens") !== num(rawUsage.output_tokens) ||
    sum("input_tokens") !== num(rawUsage.input_tokens)
  ) {
    warnings.push(
      `usage.iterations sum != top-level usage for request ${requestId} - using top-level (never summing iterations)`,
    );
  }
}

/** Size of a tool result in characters, preferring the content actually fed back to the model. */
function toolResultChars(rec: any, block: any): number {
  if (typeof block?.content === "string") return block.content.length;
  if (Array.isArray(block?.content)) {
    let n = 0;
    for (const b of block.content) if (typeof b?.text === "string") n += b.text.length;
    if (n > 0) return n;
  }
  const tur = rec.toolUseResult;
  if (typeof tur === "string") return tur.length;
  if (tur && typeof tur === "object") {
    try {
      return JSON.stringify(tur).length;
    } catch {
      return 0;
    }
  }
  return 0;
}

interface ParseResult {
  stream: Stream;
  requests: NormalizedRequest[];
  sessionId?: string;
  skipped: number;
  warnings: string[];
  firstTs?: string;
  lastTs?: string;
}

function parseFile(file: string, subagent?: string): ParseResult {
  const events: TimelineEvent[] = [];
  const res: ParseResult = {
    stream: { subagent, events },
    requests: [],
    skipped: 0,
    warnings: [],
  };
  const byRequestId = new Map<string, NormalizedRequest>();
  const toolNameById = new Map<string, string>();
  const lines = fs.readFileSync(file, "utf8").split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      res.skipped++;
      continue;
    }
    if (typeof rec !== "object" || rec === null) {
      res.skipped++;
      continue;
    }
    if (rec.sessionId && !res.sessionId) res.sessionId = rec.sessionId;
    if (rec.timestamp) {
      if (!res.firstTs || rec.timestamp < res.firstTs) res.firstTs = rec.timestamp;
      if (!res.lastTs || rec.timestamp > res.lastTs) res.lastTs = rec.timestamp;
    }
    if (IGNORED_TYPES.has(rec.type)) continue;

    if (rec.type === "assistant") {
      const usage = rec.message?.usage;
      const requestId = rec.requestId;
      if (!usage || !requestId) continue;

      // Register tool_use blocks regardless of dedupe - content blocks of one
      // request are spread across multiple records sharing the requestId.
      const newToolCalls: { id: string; name: string }[] = [];
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_use" && typeof block.name === "string") {
            toolNameById.set(block.id, block.name);
            newToolCalls.push({ id: block.id, name: block.name });
          }
        }
      }

      const existing = byRequestId.get(requestId);
      if (existing) {
        existing.toolCalls.push(...newToolCalls);
        continue; // usage already counted - core dedupe invariant
      }
      // Synthetic/internal records (e.g. model "<synthetic>") with zero usage
      // are harness bookkeeping, not billable API calls - skip them.
      const model: string = rec.message.model ?? "unknown";
      const zeroUsage =
        num(usage.input_tokens) +
          num(usage.output_tokens) +
          num(usage.cache_read_input_tokens) +
          num(usage.cache_creation_input_tokens) ===
        0;
      if (zeroUsage && model.startsWith("<")) continue;
      checkIterations(usage, res.warnings, requestId);
      const req: NormalizedRequest = {
        requestId,
        model,
        timestamp: rec.timestamp ?? "",
        usage: toUsage(usage),
        toolCalls: newToolCalls,
        subagent,
      };
      byRequestId.set(requestId, req);
      res.requests.push(req);
      events.push({ kind: "request", request: req });
      continue;
    }

    if (rec.type === "user") {
      const content = rec.message?.content;
      if (typeof content === "string") {
        events.push({
          kind: "userPrompt",
          chars: content.length,
          timestamp: rec.timestamp ?? "",
        });
      } else if (Array.isArray(content)) {
        let sawToolResult = false;
        for (const block of content) {
          if (block?.type === "tool_result") {
            sawToolResult = true;
            events.push({
              kind: "toolResult",
              toolName: toolNameById.get(block.tool_use_id) ?? "unknown",
              chars: toolResultChars(rec, block),
              timestamp: rec.timestamp ?? "",
            });
          }
        }
        if (!sawToolResult) {
          const chars = content.reduce(
            (a: number, b: any) => a + (typeof b?.text === "string" ? b.text.length : 0),
            0,
          );
          if (chars > 0) {
            events.push({ kind: "userPrompt", chars, timestamp: rec.timestamp ?? "" });
          }
        }
      }
    }
  }
  return res;
}

function subagentFiles(sessionFile: string): string[] {
  const dir = path.join(
    path.dirname(sessionFile),
    path.basename(sessionFile, ".jsonl"),
    "subagents",
  );
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
}

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",

  detect(p: string): boolean {
    return p.endsWith(".jsonl");
  },

  parse(sessionFile: string): NormalizedSession {
    const main = parseFile(sessionFile);
    let skipped = main.skipped;
    const warnings = [...main.warnings];
    const requests = [...main.requests];
    const streams: Stream[] = [main.stream];
    let firstTs = main.firstTs;
    let lastTs = main.lastTs;

    for (const sf of subagentFiles(sessionFile)) {
      const sub = parseFile(sf, path.basename(sf, ".jsonl"));
      requests.push(...sub.requests);
      streams.push(sub.stream);
      skipped += sub.skipped;
      warnings.push(...sub.warnings);
      if (sub.firstTs && (!firstTs || sub.firstTs < firstTs)) firstTs = sub.firstTs;
      if (sub.lastTs && (!lastTs || sub.lastTs > lastTs)) lastTs = sub.lastTs;
    }

    return {
      sessionId: main.sessionId ?? path.basename(sessionFile, ".jsonl"),
      sourcePath: sessionFile,
      requests,
      streams,
      models: [...new Set(requests.map((r) => r.model))],
      startTime: firstTs,
      endTime: lastTs,
      skippedLines: skipped,
      warnings,
    };
  },
};
