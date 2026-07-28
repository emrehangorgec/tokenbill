import type { NormalizedRequest, NormalizedSession, Usage } from "../adapters/types.js";
import { lookupPrice, SERVER_TOOL_PRICING, TIER_MULTIPLIERS } from "./pricing.js";

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
  serverToolUse: { webSearch: number; webFetch: number; costUSD: number };
  subagentUSD: number;
  requestCount: number;
}

/**
 * Per-request charges for Anthropic-hosted server tools. Billed per call rather
 * than per token, so this sits alongside the token math instead of inside it.
 */
export function serverToolCostUSD(u: Usage): number {
  const st = u.server_tool_use;
  if (!st) return 0;
  return (
    (st.web_search_requests ?? 0) * SERVER_TOOL_PRICING.webSearchPerRequest +
    (st.web_fetch_requests ?? 0) * SERVER_TOOL_PRICING.webFetchPerRequest
  );
}

export function requestCostUSD(req: NormalizedRequest): number {
  // Priced against the request's own timestamp: rates have effective dates, so
  // a session logged before a promotional window closed must keep the rate it
  // was actually billed at.
  const { price } = lookupPrice(req.model, req.timestamp);
  const u = req.usage;

  // Fast mode runs the same model at premium rates; batch tier discounts every
  // token class. Priority tier is not modelled - see README caveats.
  const rates = u.speed === "fast" && price.fast ? price.fast : price;
  const tierMult = u.service_tier === "batch" ? TIER_MULTIPLIERS.batch : 1;

  const perTokIn = (rates.inputPerMTok / 1e6) * tierMult;
  const perTokOut = (rates.outputPerMTok / 1e6) * tierMult;

  // Cache writes: price by TTL split when available, else assume 5m.
  const split = u.cache_creation;
  const w5m = split ? split.ephemeral_5m_input_tokens : u.cache_creation_input_tokens;
  const w1h = split ? split.ephemeral_1h_input_tokens : 0;

  return (
    u.input_tokens * perTokIn +
    u.output_tokens * perTokOut +
    u.cache_read_input_tokens * perTokIn * price.cacheReadMult +
    w5m * perTokIn * price.cacheWrite5mMult +
    w1h * perTokIn * price.cacheWrite1hMult +
    serverToolCostUSD(u)
  );
}

export function calculate(session: NormalizedSession): CostBreakdown {
  const perModel = new Map<string, ModelBreakdown>();
  const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const serverToolUse = { webSearch: 0, webFetch: 0, costUSD: 0 };
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
    serverToolUse.costUSD += serverToolCostUSD(u);

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
        pricedExactly: lookupPrice(req.model, req.timestamp).exact,
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
