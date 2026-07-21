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
footer.

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
