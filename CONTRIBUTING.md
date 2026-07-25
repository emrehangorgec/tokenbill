# Contributing

## Setup

```
npm install
npm test          # vitest: unit + golden-file snapshot tests
npx tsc --noEmit  # type check
npm run dev       # tsx src/cli.ts (run the CLI against your own logs)
```

## Adding an adapter

`tokenbill` supports multiple AI coding agents through an adapter interface
(`src/adapters/types.ts`). An adapter turns an agent's raw log format into a
`NormalizedSession`:

```ts
export interface Adapter {
  name: string;
  detect(path: string): boolean;
  parse(path: string): NormalizedSession;
}
```

`src/adapters/claude-code.ts` is the reference implementation - read it first.
A new adapter (Codex CLI, Gemini CLI, etc.) needs its own file under
`src/adapters/`, a `detect`/`parse` pair, and test fixtures under `fixtures/`
covering a normal session plus edge cases (corrupt lines, missing fields).

## Updating pricing

The price table lives in one file, [`src/cost/pricing.ts`](src/cost/pricing.ts).
Bump the `asOf` date alongside any price change - it's printed in every report
footer. That file holds both `PRICE_TABLE` (per-token model rates) and
`SERVER_TOOL_PRICING` (per-request charges for web search / web fetch).

Users can override either without waiting for a release. `--pricing` accepts the
bare model array, or an object with the parts you want to replace:

```json
{
  "models": [{ "match": "claude-opus-5", "inputPerMTok": 5, "outputPerMTok": 25,
               "cacheReadMult": 0.1, "cacheWrite5mMult": 1.25, "cacheWrite1hMult": 2 }],
  "serverTools": { "webSearchPerRequest": 0.01, "webFetchPerRequest": 0 }
}
```

## Test fixtures

Fixtures under `fixtures/` are anonymized real session logs (same-length
placeholder text; structure, token counts, and tool names preserved). Use
[`scripts/anonymize.ts`](scripts/anonymize.ts) to prepare a new fixture from a
real log before committing it - never commit raw, unanonymized logs.

If your change affects report output, regenerate golden snapshots and review
the diff by eye before committing:

```
npx vitest run -u
```

## Before opening a PR

- `npm test` and `npx tsc --noEmit` pass.
- Keep the change focused - avoid bundling unrelated edits.
