// Stations you entered lately (0.48.0): offered first when adding, before scenic lines and your
// trips. Kept on this device (not synced: a convenience, not data), newest first, each once.
// Pure: the store is `src/ui/recentStops.ts`.
import type { Waypoint } from './model';
import { stopKey } from './stops';

export type RecentStop = Pick<Waypoint, 'stopRef' | 'name'>;

/** How many are kept; the sheet shows `SHOWN` of them. */
export const RECENT_MAX = 20;
export const SHOWN = 6;

/** `stops` put first (the last of them first), each once by its key, at most `RECENT_MAX`. */
export function remember(list: readonly RecentStop[], stops: readonly RecentStop[]): RecentStop[] {
  const out: RecentStop[] = [];
  const seen = new Set<string>();
  for (const s of [...stops].reverse().concat(list)) {
    const k = stopKey(s.stopRef);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ stopRef: s.stopRef, name: s.name });
  }
  return out.slice(0, RECENT_MAX);
}

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
