export interface CacheCreationSplit {
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation?: CacheCreationSplit;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
}

export interface ToolCall {
  id: string;
  name: string;
}

/** One deduplicated API request (one requestId). */
export interface NormalizedRequest {
  requestId: string;
  model: string;
  timestamp: string;
  usage: Usage;
  /** tool_use blocks emitted by this request (accumulated across its records) */
  toolCalls: ToolCall[];
  /** set if this request came from a subagent log */
  subagent?: string;
}

export type TimelineEvent =
  | { kind: "request"; request: NormalizedRequest }
  | { kind: "toolResult"; toolName: string; chars: number; timestamp: string }
  | { kind: "userPrompt"; chars: number; timestamp: string };

/** One chronological event stream (the main session, or one subagent). */
export interface Stream {
  subagent?: string;
  events: TimelineEvent[];
}

export interface NormalizedSession {
  sessionId: string;
  sourcePath: string;
  requests: NormalizedRequest[];
  streams: Stream[];
  models: string[];
  startTime?: string;
  endTime?: string;
  skippedLines: number;
  warnings: string[];
}

export interface Adapter {
  name: string;
  detect(path: string): boolean;
  parse(path: string): NormalizedSession;
}
