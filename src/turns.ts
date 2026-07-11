/**
 * Turn segmentation + top-N expensive turns.
 * A turn = one human prompt through the last request before the next prompt.
 * Subagent requests are folded into the turn whose time window contains them.
 */
import type { NormalizedRequest, NormalizedSession } from "./adapters/types.js";
import { requestCostUSD } from "./cost/calculator.js";

export interface Turn {
  index: number;
  startTime: string;
  costUSD: number;
  outputTokens: number;
  inputGrowthTokens: number;
  toolCounts: Map<string, number>;
  subagents: Set<string>;
  hasCompaction: boolean;
  description: string;
}

function describe(t: Turn): string {
  const tools = [...t.toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  const parts: string[] = [];
  if (tools.length === 0) {
    parts.push("text response");
  } else {
    parts.push(
      tools
        .slice(0, 3)
        .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
        .join(" + "),
    );
    if (tools.length > 3) parts.push(`+${tools.length - 3} more tools`);
  }
  if (t.subagents.size > 0) parts.push(`sub-agent ×${t.subagents.size}`);
  if (t.hasCompaction) parts.push("context compacted");
  return parts.join(", ");
}

export function segmentTurns(session: NormalizedSession): Turn[] {
  const main = session.streams[0];
  if (!main) return [];
  const turns: Turn[] = [];
  let cur: Turn | undefined;
  let prevEffIn: number | null = null;

  const newTurn = (ts: string): Turn => ({
    index: turns.length,
    startTime: ts,
    costUSD: 0,
    outputTokens: 0,
    inputGrowthTokens: 0,
    toolCounts: new Map(),
    subagents: new Set(),
    hasCompaction: false,
    description: "",
  });

  const addRequest = (t: Turn, req: NormalizedRequest) => {
    t.costUSD += requestCostUSD(req);
    t.outputTokens += req.usage.output_tokens;
    for (const call of req.toolCalls) {
      t.toolCounts.set(call.name, (t.toolCounts.get(call.name) ?? 0) + 1);
    }
    const effIn = req.usage.input_tokens + req.usage.cache_read_input_tokens;
    if (prevEffIn !== null) {
      const delta = effIn - prevEffIn;
      if (delta >= 0) t.inputGrowthTokens += delta;
      else t.hasCompaction = true;
    } else {
      t.inputGrowthTokens += effIn;
    }
    prevEffIn = effIn;
  };

  for (const ev of main.events) {
    if (ev.kind === "userPrompt") {
      if (cur) turns.push(cur);
      cur = newTurn(ev.timestamp);
    } else if (ev.kind === "request") {
      cur ??= newTurn(ev.request.timestamp);
      addRequest(cur, ev.request);
    }
  }
  if (cur) turns.push(cur);

  // Fold subagent requests into the containing turn by timestamp.
  const windows = turns.map((t, i) => ({
    t,
    start: t.startTime,
    end: turns[i + 1]?.startTime ?? "￿",
  }));
  for (const stream of session.streams.slice(1)) {
    for (const ev of stream.events) {
      if (ev.kind !== "request") continue;
      const ts = ev.request.timestamp;
      const w =
        windows.find((w) => ts >= w.start && ts < w.end) ?? windows[windows.length - 1];
      if (!w) continue;
      w.t.costUSD += requestCostUSD(ev.request);
      w.t.outputTokens += ev.request.usage.output_tokens;
      if (stream.subagent) w.t.subagents.add(stream.subagent);
    }
  }

  for (const t of turns) t.description = describe(t);
  return turns;
}

export function topTurns(session: NormalizedSession, n = 10): Turn[] {
  return segmentTurns(session)
    .filter((t) => t.costUSD > 0)
    .sort((a, b) => b.costUSD - a.costUSD)
    .slice(0, n);
}
