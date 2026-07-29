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

**The price table is generated, not hand-edited.** Three files, one of which you
never touch:

| File | Edited by | Holds |
|---|---|---|
| [`src/cost/prices.generated.ts`](src/cost/prices.generated.ts) | the sync script | the shipped rates. **Do not edit.** |
| [`src/cost/pricing.overrides.json`](src/cost/pricing.overrides.json) | you | facts the feed can't express |
| [`src/cost/pricing.ts`](src/cost/pricing.ts) | you | the lookup logic, effective-date resolution |

```bash
npm run pricing:sync    # refresh the generated table from upstream
npm run pricing:audit   # validate it offline (also runs in CI and on publish)
```

`npm run pricing:sync` is the only thing in this project that touches the
network, and it never ships - `files` publishes `dist` only. tokenbill itself
still makes zero network calls; see [Privacy](README.md#privacy). Run it
manually whenever upstream rates need refreshing.

### When to edit the overrides file

The machine feed reports one undated price per model. Anything it can't express
belongs in `pricing.overrides.json`:

- **A promotional rate started or ended.** Declare both windows under
  `windows`, with `effectiveFrom` / `effectiveTo`. Without them the feed's
  single number gets applied to sessions on both sides of the boundary, and one
  of those answers is wrong. Requests are priced against their own timestamp,
  so old sessions keep the rate they were actually billed at.
- **Fast mode.** `usage.speed === "fast"` runs the same model at a premium
  (Opus 5: $10/$50, double standard). Listed under `fast`.
- **A retired model.** Its rate is frozen forever, so pin it under `models`
  rather than depending on the feed to keep carrying it.
- **A generic prefix that would mis-price siblings.** `claude-opus-4` as a
  prefix matches both Opus 4.1 ($15/$75) and Opus 4.5 ($5/$25) - one of them
  has to be wrong. Such keys go in `drop.keys`, and every version gets its own
  explicit row. An unmatched model must fall through to the flagged fallback,
  never to a wrong sibling's rate.

Set `"verify": true` on a hand-entered rate and the sync script will cross-check
it against the feed and report a mismatch instead of trusting either blindly.

### Reviewing sync output

The feed is a third-party aggregation and it is sometimes wrong: some older
entries carry cache costs on a different scale to their base rate, which derive
to impossible multipliers (a 24× one-hour cache write). The script clamps
anything outside a plausible band and reports it, but read the notes in the run
log. Sanity anchors: cache read `0.1×`, 5-minute write `1.25×`, 1-hour write
`2×`.

### Overriding prices without a release

Users can replace either table at runtime. `--pricing` accepts the bare model
array, or an object with the parts you want to replace:

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
