import type { NormalizedRequest, NormalizedSession } from "../adapters/types.js";
import { lookupPrice } from "./pricing.js";

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelBreakdown extends TokenTotals {
  model: string;
  requests: number;
  costUSD: number;
  pricedExactly: boolean;
}

export interface CostBreakdown {
  totalUSD: number;
  perModel: ModelBreakdown[];
  tokens: TokenTotals;
  serverToolUse: { webSearch: number; webFetch: number };
  subagentUSD: number;
  requestCount: number;
}

export function requestCostUSD(req: NormalizedRequest): number {
  const { price } = lookupPrice(req.model);
  const u = req.usage;
  const perTokIn = price.inputPerMTok / 1e6;
  const perTokOut = price.outputPerMTok / 1e6;

  // Cache writes: price by TTL split when available, else assume 5m.
  const split = u.cache_creation;
  const w5m = split ? split.ephemeral_5m_input_tokens : u.cache_creation_input_tokens;
  const w1h = split ? split.ephemeral_1h_input_tokens : 0;

  return (
    u.input_tokens * perTokIn +
    u.output_tokens * perTokOut +
    u.cache_read_input_tokens * perTokIn * price.cacheReadMult +
    w5m * perTokIn * price.cacheWrite5mMult +
    w1h * perTokIn * price.cacheWrite1hMult
  );
}

export function calculate(session: NormalizedSession): CostBreakdown {
  const perModel = new Map<string, ModelBreakdown>();
  const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const serverToolUse = { webSearch: 0, webFetch: 0 };
  let totalUSD = 0;
  let subagentUSD = 0;

  for (const req of session.requests) {
    const cost = requestCostUSD(req);
    totalUSD += cost;
    if (req.subagent) subagentUSD += cost;

    const u = req.usage;
    tokens.input += u.input_tokens;
    tokens.output += u.output_tokens;
    tokens.cacheRead += u.cache_read_input_tokens;
    tokens.cacheWrite += u.cache_creation_input_tokens;
    serverToolUse.webSearch += u.server_tool_use?.web_search_requests ?? 0;
    serverToolUse.webFetch += u.server_tool_use?.web_fetch_requests ?? 0;

    let mb = perModel.get(req.model);
    if (!mb) {
      mb = {
        model: req.model,
        requests: 0,
        costUSD: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        pricedExactly: lookupPrice(req.model).exact,
      };
      perModel.set(req.model, mb);
    }
    mb.requests++;
    mb.costUSD += cost;
    mb.input += u.input_tokens;
    mb.output += u.output_tokens;
    mb.cacheRead += u.cache_read_input_tokens;
    mb.cacheWrite += u.cache_creation_input_tokens;
  }

  return {
    totalUSD,
    perModel: [...perModel.values()].sort((a, b) => b.costUSD - a.costUSD),
    tokens,
    serverToolUse,
    subagentUSD,
    requestCount: session.requests.length,
  };
}
