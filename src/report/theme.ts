/**
 * Hand-rolled ANSI theming. Zero dependencies.
 *
 * Rule of thumb for callers: pad plain strings FIRST, colorize AFTER.
 * padStart/padEnd count escape codes as characters and break alignment.
 */

let enabled =
  !!process.env.FORCE_COLOR ||
  (process.stdout.isTTY === true && !process.env.NO_COLOR);

export function setColorEnabled(on: boolean): void {
  enabled = on;
}

export function colorEnabled(): boolean {
  return enabled;
}

/** 256-color palette. */
export const palette = {
  brand: 45, // bright cyan
  generation: 170, // magenta
  toolResults: 75, // blue
  fileReads: 80, // cyan
  overhead: 245, // gray
  cacheWrites: 179, // soft yellow
  compaction: 203, // red
  good: 78, // green
  warn: 214, // orange-yellow
  bad: 203, // red
} as const;

export function paint(color: number, s: string): string {
  return enabled ? `\x1b[38;5;${color}m${s}\x1b[0m` : s;
}

export function bold(s: string): string {
  return enabled ? `\x1b[1m${s}\x1b[22m` : s;
}

export function dim(s: string): string {
  return enabled ? `\x1b[2m${s}\x1b[22m` : s;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Length of a string as seen on screen (ANSI escapes stripped). */
export function visibleWidth(s: string): number {
  return s.replace(ANSI_RE, "").length;
}
