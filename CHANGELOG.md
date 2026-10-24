# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `--since` accepts a relative duration (`7d`, `2w`) in addition to an
  absolute `YYYY-MM-DD` date, counting back from today (UTC), inclusive.

## [0.7.1] - 2026-10-23

### Changed
- With `--redact`, the share card leads with its costliest finding and the
  change that helps, instead of a list of tool calls.
- The card's plan comparison says how many days of use it covers when that
  is less than the month.
- The card's day strip is labeled with the day it ends on instead of
  "last 30 days".
- Long card labels are cut at a word boundary.
- `tokenbill card` suggests `--plan` when it was not given, and the caption
  includes the costliest finding.

## [0.7.0] - 2026-10-23

### Added
- `tokenbill card`: a share image of a project's spend (1200×630 layout, PNG
  rendered at 2×), made locally without a browser, with a ready-to-paste caption and an optional
  `--plan` comparison against a Claude subscription's price.
- Expensive turns are labeled with the prompt that started them.
- `--redact` hides prompt text in every report; the GitHub Action uses it for
  job summaries.
- `--all`: one report across every project under `~/.claude/projects`.
- `--since <date>`: include only sessions starting on or after a date.
- README now opens with a share card generated from a real project with
  prompts hidden.
- CI installs the packed tarball into an empty project on Linux, Windows and
  macOS and renders a card from it.

### Changed
- Cost categories use plain-language names, and the terminal report explains
  the biggest one.
- Project reports are titled with the project folder name instead of the log
  directory path.
- MCP tools appear under their tool name (`update_plan`) instead of the full
  `mcp__server__tool` identifier.
- `@resvg/resvg-js` added as an optional dependency, and the published package
  now includes the card fonts.
- Price table refreshed from the upstream feed.

### Fixed
- The weekly pricing workflow opens a new pull request after the previous one
  was merged.

## [0.6.0] - 2026-10-10

0.5.0 was versioned in the repo but never published to npm, so its changes ship
here for the first time.

### Added
- `tokenbill statusline`: live session cost, today's project spend, cache hit
  rate and prefix break warnings in Claude Code's status line.
- `--md [file]`: GitHub Markdown report for PR comments and job summaries.
- GitHub Action (`action.yml`): Markdown report in the job summary plus an
  optional budget guard.
- `--budget <usd>`: exits 2 when the total exceeds the budget (from 0.5.0).
- Server tool pricing: web search billed per request (from 0.5.0).
- Date effective pricing, fast mode and batch tier rates, weekly pricing sync
  workflow (from 0.5.0).
- Release workflow publishing to npm with provenance on version tags.

### Changed
- CI runs on Linux, Windows and macOS, and on Node 18, 20 and 24.

## [0.4.0] - 2026-07-19

### Added
- Waste advisor with dollar quantified recommendations.
- Daily spend trend for project reports.
- `--html [file]`: self contained shareable HTML report.

## [0.3.0] - 2026-07-15

### Added
- Colored terminal report, theme module, SVG demo asset and `--no-color`.

## [0.1.0] - 2026-07-11

### Added
- Initial release.

