// A Transitous (MOTIS) plan → the app's own connections (0.31.0), for legs that leave
// Switzerland. A station abroad has no SLOID: its ref is `eu:<lat>,<lon>:<id>`, which carries
// where it lies (the map, the line) and Transitous' own id; a Swiss station a foreign operator
// names its own way (Trenitalia's "ZUERICH HB") is the app's own, when `local` finds it. Pure.
import type { Connection, LatLon, Mode, PlatformCall, Section, StopCall } from '../model';

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
}) => { stopRef: string; name: string } | undefined;

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
    const name = str(p.name) ?? '';
    if (lat === undefined || lon === undefined) return undefined;
    return (
      local({ name, lat, lon }) ?? {
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
          category: str(l.routeShortName)?.replace(/\s*\d.*$/, '') || undefined,
          line: str(l.displayName) ?? str(l.routeShortName),
          operator: str(l.agencyName),
          from: { ...from, ...(fromTrack ? { platform: fromTrack } : {}) },
          to: { ...to, ...(toTrack ? { platform: toTrack } : {}) },
          intermediate: (Array.isArray(l.intermediateStops) ? l.intermediateStops : [])
            .map((s) => call(s, 'both'))
            .filter((s): s is StopCall => !!s),
          ...(geometry && geometry.length > 1 ? { geometry } : {}),
          ...(str(l.tripId) ? { journey: `eu:${str(l.tripId)}` } : {}),
          ...(str(l.headsign) ? { destination: str(l.headsign) } : {}),
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
