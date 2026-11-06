// A Transitous (MOTIS) plan → the app's own connections (0.33.0), for legs that leave
// Switzerland. A station abroad has no SLOID: its ref is `eu:<lat>,<lon>:<id>`, which carries
// where it lies (the map, the line) and Transitous' own id; a Swiss station a foreign operator
// names its own way (Trenitalia's "ZUERICH HB") is the app's own, when `local` finds it. Pure.
import type { Connection, LatLon, Mode, PlatformCall, Section, StopCall } from '../model';
import { kmBetween } from '../stops';
import hubs from '../../data/hubs.json';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A station abroad as a ref: where it is and Transitous' id. */
export const euRef = (lat: number, lon: number, id: string) =>
  `eu:${lat.toFixed(5)},${lon.toFixed(5)}:${id}`;

/** Where a station abroad lies, from its ref; undefined for any other ref. */
export function euPos(ref: string): LatLon | undefined {
  const m = /^eu:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?):/.exec(ref);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : undefined;
}

export const isEu = (ref: string) => ref.startsWith('eu:');

/** A station as Transitous names it, for a via: abroad its own id, a Swiss one by its SLOID. */
export function transitousId(ref: string, chFeed: string): string | undefined {
  const eu = /^eu:-?[\d.]+,-?[\d.]+:(.+)$/.exec(ref);
  if (eu) return eu[1];
  const sloid = /^ch:1:sloid:(\d+)/.exec(ref);
  return sloid ? `${chFeed}_ch:1:sloid:${Number(sloid[1])}` : undefined;
}

const isStop = (p: unknown) => isObj(p) && typeof p.stopId === 'string';

/** Google's encoded polyline, at MOTIS' precision (6 by default) → [lon, lat]. */
export function decodePolyline(s: string, precision = 6): [number, number][] {
  const f = 10 ** precision;
  const out: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  const next = () => {
    let shift = 0;
    let v = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      v |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < s.length + 1);
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push([lon / f, lat / f]);
  }
  return out;
}

/** A station's name that says only what it is, not where ("Hauptbahnhof": the German feed's own). */
const BARE =
  /^(hauptbahnhof|hbf|bahnhof|bf|bahnhof\/zob|zob|busbahnhof|gare|gare sncf|stazione|stazione centrale|centrale|station|centraal)$/i;
/** How far from a hub city's main station a bare name is still that city's (Paris has many). */
export const HUB_KM = 4;

/** A bare name with the city it lies in ("Stuttgart Hauptbahnhof"); any other name as it is. */
export function placeName(name: string, at: LatLon): string {
  if (!BARE.test(name.trim())) return name;
  let best: { name: string; km: number } | undefined;
  for (const h of hubs as { name: string; lat: number; lon: number }[]) {
    const km = kmBetween(at, h);
    if (km <= HUB_KM && (!best || km < best.km)) best = { name: h.name, km };
  }
  return best ? `${best.name} ${name}` : name;
}

const MODES: Record<string, Mode> = {
  BUS: 'bus',
  COACH: 'bus',
  FERRY: 'boat',
  AERIAL_LIFT: 'cableCar',
  FUNICULAR: 'cableCar',
};

/** A Swiss station the app knows, by where a foreign operator's stop lies and what it is called. */
export type Local = (p: {
  name: string;
  lat: number;
  lon: number;
  /** Transitous' own id (`de-DELFI_ch:1:sloid:3000`: a Swiss feed's SLOID). */
  id?: string;
}) => { stopRef: string; name: string } | undefined;

/**
 * A train's type and number from its full name ("ICE 565", "EC 99", "TGV 9218"): the short name
 * may be the line's number alone ("60" for an ICE), or the type alone ("IC").
 */
function kindOf(l: Record<string, unknown>): { category?: string; number?: string; line?: string } {
  const full = str(l.displayName) ?? str(l.tripShortName) ?? str(l.routeShortName);
  const m = full ? /^([A-Za-zÀ-ž]+)\s*(\d[\w-]*)?$/.exec(full.trim()) : null;
  if (m) return { category: m[1], ...(m[2] ? { number: m[2] } : {}), line: full };
  return { line: full };
}

/** Where the train goes, named as its stops are (a bare "Hauptbahnhof" by its last stop). */
function headsign(l: Record<string, unknown>): string {
  const h = str(l.headsign)!;
  // Its last stop where the answer gives it; else where this ride ends, when named the same.
  const ends = [l.tripTo, isObj(l.to) && l.to.name === h ? l.to : undefined];
  for (const e of ends) {
    if (!isObj(e) || num(e.lat) === undefined || num(e.lon) === undefined) continue;
    const named = placeName(h, { lat: num(e.lat)!, lon: num(e.lon)! });
    if (named !== h) return named;
  }
  return h;
}

export function euConnections(
  answer: unknown,
  legIndex: number,
  local: Local = () => undefined,
): Connection[] {
  if (!isObj(answer) || !Array.isArray(answer.itineraries)) return [];
  const place = (p: unknown): { stopRef: string; name: string } | undefined => {
    if (!isObj(p)) return undefined;
    const lat = num(p.lat);
    const lon = num(p.lon);
    if (lat === undefined || lon === undefined) return undefined;
    const name = placeName(str(p.name) ?? '', { lat, lon });
    return (
      local({ name, lat, lon, id: str(p.parentId) ?? str(p.stopId) }) ?? {
        stopRef: euRef(lat, lon, str(p.parentId) ?? str(p.stopId) ?? name),
        name,
      }
    );
  };
  const call = (p: unknown, at: 'dep' | 'arr' | 'both'): StopCall | undefined => {
    const where = place(p);
    if (!where || !isObj(p)) return undefined;
    const planned = (k: 'Departure' | 'Arrival') =>
      str(p[`scheduled${k}`]) ?? str(p[k.toLowerCase()]);
    const real = (k: 'Departure' | 'Arrival') => str(p[k.toLowerCase()]);
    const dep = at !== 'arr' ? planned('Departure') : undefined;
    const arr = at !== 'dep' ? planned('Arrival') : undefined;
    const depEst = dep && real('Departure') !== dep ? real('Departure') : undefined;
    const arrEst = arr && real('Arrival') !== arr ? real('Arrival') : undefined;
    return {
      ...where,
      ...(dep ? { dep } : {}),
      ...(arr ? { arr } : {}),
      ...(depEst ? { depEst } : {}),
      ...(arrEst ? { arrEst } : {}),
    };
  };
  return answer.itineraries.flatMap((it): Connection[] => {
    if (!isObj(it) || !Array.isArray(it.legs)) return [];
    const sections = it.legs.flatMap((l): Section[] => {
      if (!isObj(l)) return [];
      const from = call(l.from, 'dep') as PlatformCall | undefined;
      const to = call(l.to, 'arr') as PlatformCall | undefined;
      if (!from || !to) return [];
      // A walk to or from the bare point asked (Transitous' START and END) is no stop of the trip.
      if (l.mode === 'WALK' && (!isStop(l.from) || !isStop(l.to))) return [];
      if (l.mode === 'WALK')
        return [
          {
            mode: 'walk',
            walkMin: Math.round((num(l.duration) ?? 0) / 60),
            from: { stopRef: from.stopRef, name: from.name },
            to: { stopRef: to.stopRef, name: to.name },
            intermediate: [],
          },
        ];
      const track = (p: unknown) =>
        isObj(p) ? (str(p.scheduledTrack) ?? str(p.track)) : undefined;
      const fromTrack = track(l.from);
      const toTrack = track(l.to);
      const geometry =
        isObj(l.legGeometry) && str(l.legGeometry.points)
          ? decodePolyline(l.legGeometry.points as string, num(l.legGeometry.precision) ?? 6)
          : undefined;
      return [
        {
          mode: MODES[String(l.mode)] ?? 'rail',
          ...kindOf(l),
          operator: str(l.agencyName),
          from: { ...from, ...(fromTrack ? { platform: fromTrack } : {}) },
          to: { ...to, ...(toTrack ? { platform: toTrack } : {}) },
          intermediate: (Array.isArray(l.intermediateStops) ? l.intermediateStops : [])
            .map((s) => call(s, 'both'))
            .filter((s): s is StopCall => !!s),
          ...(geometry && geometry.length > 1 ? { geometry } : {}),
          ...(str(l.tripId) ? { journey: `eu:${str(l.tripId)}` } : {}),
          ...(str(l.headsign) ? { destination: headsign(l) } : {}),
        },
      ];
    });
    const rides = sections.filter((s) => s.mode !== 'walk');
    const dep = rides[0]?.from.dep ?? str(it.startTime);
    const arr = rides.at(-1)?.to.arr ?? str(it.endTime);
    if (!rides.length || !dep || !arr) return [];
    return [{ legIndex, dep, arr, transfers: Math.max(0, rides.length - 1), sections }];
  });
}

/**
 * The leg's own ends: Transitous names a station by its feed's id and platform (München Hbf is
 * `de-DELFI_de:09162:100` in one, `…_de:09162:100:11:11` in another, 200 m apart), so the first
 * stop and the last of each connection become the stations asked for, where they lie within
 * `END_KM` of them; the rows then find their stations, as with OJP's answers.
 */
export const END_KM = 1;
export function pinEnds(
  connections: Connection[],
  ends: { origin: { ref: string; name: string }; destination: { ref: string; name: string } },
  where: (ref: string) => LatLon | undefined,
): Connection[] {
  const near = (a: LatLon | undefined, b: LatLon | undefined) =>
    !!a && !!b && kmBetween(a, b) <= END_KM;
  const pin = <T extends { stopRef: string; name: string }>(
    c: T,
    to: { ref: string; name: string },
  ) => (near(where(c.stopRef), where(to.ref)) ? { ...c, stopRef: to.ref, name: to.name } : c);
  return connections.map((c) => {
    const sections = c.sections.map((s) => ({ ...s }));
    const first = sections[0];
    const last = sections.at(-1);
    if (first) first.from = pin(first.from, ends.origin);
    if (last) last.to = pin(last.to, ends.destination);
    return { ...c, sections };
  });
}
