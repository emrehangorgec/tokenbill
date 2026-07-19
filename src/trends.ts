/** Daily spend trend over the last N days, bucketed from session summaries. */
import type { SessionSummary } from "./aggregate.js";

export interface DayBucket {
  /** local date, YYYY-MM-DD */
  date: string;
  costUSD: number;
  sessions: number;
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Buckets session cost by the local date of each session's startTime.
 * Returns the last `days` days ending on the newest session's day (so the
 * output is deterministic for a fixed set of logs), zero-filled, oldest first.
 * Sessions without a parseable startTime are skipped.
 */
export function dailyTrend(sessions: SessionSummary[], days = 14, now?: Date): DayBucket[] {
  if (!now) {
    let newest = 0;
    for (const s of sessions) {
      const t = s.startTime ? Date.parse(s.startTime) : NaN;
      if (!isNaN(t) && t > newest) newest = t;
    }
    now = newest > 0 ? new Date(newest) : new Date();
  }
  const buckets = new Map<string, DayBucket>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const date = localDate(d);
    buckets.set(date, { date, costUSD: 0, sessions: 0 });
  }
  for (const s of sessions) {
    if (!s.startTime) continue;
    const t = new Date(s.startTime);
    if (isNaN(t.getTime())) continue;
    const b = buckets.get(localDate(t));
    if (!b) continue;
    b.costUSD += s.costUSD;
    b.sessions++;
  }
  return [...buckets.values()];
}
