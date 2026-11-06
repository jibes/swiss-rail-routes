// Europe (0.33.0) through Transitous (https://transitous.org, MOTIS, community-run): what the
// app may ask, checked here, shared with the Worker, which alone talks to Transitous (fair use:
// rail only, few results, cached). Pure.

export interface EuStopQuery {
  text: string;
}

export interface EuPoint {
  lat: number;
  lon: number;
}

export interface EuPlanQuery {
  from: EuPoint;
  to: EuPoint;
  /** ISO UTC. */
  time: string;
  arriveBy: boolean;
  results: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Europe and around: Lisbon to Moscow, Sicily to Narvik. */
const point = (v: unknown): EuPoint | null =>
  isObj(v) &&
  typeof v.lat === 'number' &&
  typeof v.lon === 'number' &&
  v.lat >= 34 &&
  v.lat <= 72 &&
  v.lon >= -11 &&
  v.lon <= 40
    ? { lat: Math.round(v.lat * 1e5) / 1e5, lon: Math.round(v.lon * 1e5) / 1e5 }
    : null;

export function parseEuStopQuery(v: unknown): EuStopQuery | string {
  if (!isObj(v) || typeof v.text !== 'string') return 'text';
  const text = v.text.trim();
  return text.length < 2 || text.length > 80 ? 'text' : { text };
}

export function parseEuPlanQuery(v: unknown): EuPlanQuery | string {
  if (!isObj(v)) return 'body';
  const from = point(v.from);
  const to = point(v.to);
  if (!from) return 'from';
  if (!to) return 'to';
  if (typeof v.time !== 'string' || Number.isNaN(Date.parse(v.time))) return 'time';
  const results = v.results ?? 3;
  if (!Number.isInteger(results) || (results as number) < 1 || (results as number) > 5)
    return 'results';
  return {
    from,
    to,
    time: new Date(Date.parse(v.time)).toISOString(),
    arriveBy: v.arriveBy === true,
    results: results as number,
  };
}

/** Transitous' plan address for a query: trains only (buses and coaches are not this app's). */
export function euPlanUrl(base: string, q: EuPlanQuery): string {
  const p = new URLSearchParams({
    fromPlace: `${q.from.lat},${q.from.lon}`,
    toPlace: `${q.to.lat},${q.to.lon}`,
    time: q.time,
    arriveBy: String(q.arriveBy),
    numItineraries: String(q.results),
    transitModes: 'RAIL',
    detailedTransfers: 'false',
  });
  return `${base.replace(/[/]$/, '')}/api/v5/plan?${p}`;
}

export function euStopsUrl(base: string, q: EuStopQuery): string {
  const p = new URLSearchParams({ text: q.text, type: 'STOP' });
  return `${base.replace(/[/]$/, '')}/api/v1/geocode?${p}`;
}

const RAIL = new Set(['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_RAIL', 'RAIL']);

export interface EuStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country?: string;
}

/** Of Transitous' geocoding answer, the railway stations, at most 8 (the Worker answers these). */
export function euStations(answer: unknown): EuStop[] {
  if (!Array.isArray(answer)) return [];
  return answer
    .filter(
      (x): x is Record<string, unknown> =>
        isObj(x) &&
        typeof x.id === 'string' &&
        typeof x.name === 'string' &&
        typeof x.lat === 'number' &&
        typeof x.lon === 'number' &&
        Array.isArray(x.modes) &&
        x.modes.some((m) => RAIL.has(String(m))),
    )
    .slice(0, 8)
    .map((x) => ({
      id: x.id as string,
      name: x.name as string,
      lat: x.lat as number,
      lon: x.lon as number,
      ...(typeof x.country === 'string' ? { country: x.country } : {}),
    }));
}
