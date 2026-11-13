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
  /** Stations to pass (0.33.2), Transitous' own ids, at most two (its limit). */
  vias?: string[];
}

/**
 * Transitous' feed for Switzerland: a Swiss station's id there is `<feed>_ch:1:sloid:<n>`. The
 * name carries the timetable year; when it changes, a via is not found and the leg is asked
 * again without it (the plan then says the via is missed), until this follows.
 */
export const CH_FEED = 'ch-opentransportdataswiss26';
const VIA = /^[\w:.-]{1,160}$/;

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
  const vias = v.vias ?? [];
  if (
    !Array.isArray(vias) ||
    vias.length > 2 ||
    vias.some((x) => typeof x !== 'string' || !VIA.test(x))
  )
    return 'vias';
  return {
    from,
    to,
    ...(vias.length ? { vias: vias as string[] } : {}),
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
  if (q.vias?.length) p.set('via', q.vias.join(','));
  return `${base.replace(/[/]$/, '')}/api/v5/plan?${p}`;
}

/** Stops and places by name (places too: a town's stations are found by the town, below). */
export function euStopsUrl(base: string, q: EuStopQuery): string {
  const p = new URLSearchParams({ text: q.text });
  return `${base.replace(/[/]$/, '')}/api/v1/geocode?${p}`;
}

/** Half the box looked in round a town for its stations, degrees (about 4.5 by 4 km there). */
const AREA_LAT = 0.04;
const AREA_LON = 0.08;

export interface EuPlace {
  lat: number;
  lon: number;
  country?: string;
}

/**
 * Of Transitous' geocoding answer, the first town (a second was noise: "Narvik" a street in
 * Stockholm). Its search ranks a small town's stations
 * below bus stops of the same name, or not at all (13 Nov 2026: "Umeå" no station, "Boden" a
 * Swiss halt and bus stops, not Boden C), but finds the town: its stations are looked up there.
 */
export function euPlaces(answer: unknown): EuPlace[] {
  if (!Array.isArray(answer)) return [];
  return answer
    .filter(
      (x): x is Record<string, unknown> =>
        isObj(x) && x.type === 'PLACE' && typeof x.lat === 'number' && typeof x.lon === 'number',
    )
    .slice(0, 1)
    .map((x) => ({
      lat: x.lat as number,
      lon: x.lon as number,
      ...(typeof x.country === 'string' ? { country: x.country } : {}),
    }));
}

/** Two stops this near are one station (several feeds name it: "Lyon Part Dieu" eight times). */
const SAME_KM = 0.3;
const kmBetween = (a: EuStop, b: EuStop) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371;
};

/** Transitous' stops within a box round a town. */
export function euAreaUrl(base: string, p: EuPlace): string {
  const q = new URLSearchParams({
    min: `${(p.lat - AREA_LAT).toFixed(5)},${(p.lon - AREA_LON).toFixed(5)}`,
    max: `${(p.lat + AREA_LAT).toFixed(5)},${(p.lon + AREA_LON).toFixed(5)}`,
  });
  return `${base.replace(/[/]$/, '')}/api/v1/map/stops?${q}`;
}

/** The railway stations of an area's stops, the most important first, with the town's country. */
export function euAreaStations(answer: unknown, place: EuPlace): EuStop[] {
  if (!Array.isArray(answer)) return [];
  return answer
    .filter(
      (x): x is Record<string, unknown> =>
        isObj(x) &&
        typeof x.stopId === 'string' &&
        typeof x.name === 'string' &&
        typeof x.lat === 'number' &&
        typeof x.lon === 'number' &&
        Array.isArray(x.modes) &&
        x.modes.some((m) => RAIL.has(String(m))),
    )
    .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0))
    .map((x) => ({
      id: x.stopId as string,
      name: x.name as string,
      lat: x.lat as number,
      lon: x.lon as number,
      ...(place.country ? { country: place.country } : {}),
    }));
}

/** The town's stations, then those found by name, each station once, at most 8. */
export function euStationsMerged(byName: EuStop[], byTown: EuStop[][]): EuStop[] {
  const out: EuStop[] = [];
  for (const s of [...byTown.flat(), ...byName])
    if (out.length < 8 && !out.some((o) => o.id === s.id || kmBetween(o, s) < SAME_KM)) out.push(s);
  return out;
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
