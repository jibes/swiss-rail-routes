// Stations you entered lately (0.48.0): offered first when adding, before scenic lines and your
// trips. Newest first, each once; synced with your trips (0.48.1): devices merge by station, the
// later pick wins (`mergeRecent`). Pure: the store is `src/ui/recentStops.ts`.
import type { Waypoint } from './model';
import { stopKey } from './stops';

export type RecentStop = Pick<Waypoint, 'stopRef' | 'name'> & {
  /** When it was picked, ms; kept from before sync (0.48.0) without one, as the oldest. */
  at?: number;
};

/** How many are kept; the sheet shows `SHOWN` of them. */
export const RECENT_MAX = 20;
export const SHOWN = 6;

/**
 * `stops` picked at `now` put first (the last of them first, a millisecond apart), each once by
 * its key, at most `RECENT_MAX`.
 */
export function remember(
  list: readonly RecentStop[],
  stops: readonly RecentStop[],
  now: number,
): RecentStop[] {
  const picked = stops.map((s, i) => ({
    stopRef: s.stopRef,
    name: s.name,
    at: now - (stops.length - 1 - i),
  }));
  return mergeRecent(picked, list);
}

/**
 * Two devices' lists as one: each station once (by its key), at its latest pick; newest first,
 * at most `RECENT_MAX`. The same on every device, whichever merges (ties by ref).
 */
export function mergeRecent(a: readonly RecentStop[], b: readonly RecentStop[]): RecentStop[] {
  const by = new Map<string, RecentStop>();
  for (const s of [...a, ...b]) {
    const k = stopKey(s.stopRef);
    const o = by.get(k);
    const at = s.at ?? 0;
    if (!o || at > (o.at ?? 0) || (at === (o.at ?? 0) && s.stopRef < o.stopRef))
      by.set(k, { stopRef: s.stopRef, name: s.name, at });
  }
  return [...by.values()]
    .sort((x, y) => (y.at ?? 0) - (x.at ?? 0) || (x.stopRef < y.stopRef ? -1 : 1))
    .slice(0, RECENT_MAX);
}

/** Whether two lists hold the same stations at the same times, in the same order. */
export const sameRecent = (a: readonly RecentStop[], b: readonly RecentStop[]) =>
  a.length === b.length &&
  a.every((x, i) => x.stopRef === b[i]!.stopRef && (x.at ?? 0) === (b[i]!.at ?? 0));

/**
 * The stations to offer: those you entered, then the stations of your trips (most recent first,
 * a scenic line's own left out: those come with the line), so the list is useful from the
 * first day; never one in `exclude` (the station it adds after and the one after it).
 */
export function recentStations(
  picked: readonly RecentStop[],
  routes: readonly (readonly Waypoint[])[],
  exclude: readonly string[],
  n = SHOWN,
): RecentStop[] {
  const out: RecentStop[] = [];
  const seen = new Set(exclude.map(stopKey));
  const add = (s: RecentStop) => {
    const k = stopKey(s.stopRef);
    if (seen.has(k) || out.length >= n) return;
    seen.add(k);
    out.push({ stopRef: s.stopRef, name: s.name });
  };
  picked.forEach(add);
  for (const r of routes) for (const w of r) if (!w.ring) add(w);
  return out;
}
