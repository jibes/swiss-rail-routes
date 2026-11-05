// Places people go to by train (`src/data/attractions.json`, curated): a search for one gives the
// stops nearest it, with an estimate of the walk. Bundled, no geocoder: nothing typed leaves the
// device for it. Pure.
import type { Lang } from '../i18n';
import type { LatLon } from './model';
import { fold, kmBetween } from './stops';

export interface Attraction {
  id: string;
  name: Record<Lang, string>;
  lat: number;
  lon: number;
  /** Its stops, nearest or most useful first (a train station before a bus stop beside it). */
  stops: { ref: string; name: string }[];
}

export interface AttractionData {
  v: 1;
  attractions: Attraction[];
}

/** Walking speed and how much longer a walk is than the straight line, for the estimate. */
const WALK_KMH = 4.5;
const DETOUR = 1.3;

/** Minutes on foot over a straight-line distance: an estimate (paths wind, hills are not seen). */
export const walkMinutes = (km: number) => Math.max(1, Math.round(((km * DETOUR) / WALK_KMH) * 60));

export interface AttractionHit {
  id: string;
  name: string;
  stops: { ref: string; name: string; walkMin: number }[];
}

/**
 * Attractions whose name, in any of the four languages, has every word of the query starting one
 * of its words ("Rhine falls", "Rheinfall", "chutes"), the best match first; each with its stops and
 * the walk from them. `at` gives a stop's place; a stop the index does not know is left out.
 */
export function searchAttractions(
  data: AttractionData,
  query: string,
  lang: Lang,
  at: (ref: string) => LatLon | undefined,
  limit = 3,
): AttractionHit[] {
  const q = fold(query);
  if (q.length < 3) return [];
  const qWords = q.split(' ');
  const ranked: [Attraction, number][] = [];
  for (const a of data.attractions) {
    let best = Infinity;
    for (const n of Object.values(a.name)) {
      const f = fold(n);
      const words = f.split(' ');
      if (!qWords.every((w) => words.some((x) => x.startsWith(w)))) continue;
      best = Math.min(best, f === q ? 0 : f.startsWith(q) ? 1 : 2);
    }
    if (best < Infinity) ranked.push([a, best]);
  }
  return ranked
    .sort((x, y) => x[1] - y[1])
    .slice(0, limit)
    .map(([a]) => ({
      id: a.id,
      name: a.name[lang] ?? a.name.en,
      stops: a.stops.flatMap((s) => {
        const p = at(s.ref);
        return p ? [{ ...s, walkMin: walkMinutes(kmBetween(a, p)) }] : [];
      }),
    }))
    .filter((h) => h.stops.length > 0);
}
