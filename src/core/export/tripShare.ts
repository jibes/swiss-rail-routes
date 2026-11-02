// Share a trip as its exact timetable (`#/j/<data>`): the trip with its tracks simplified to
// ~100 m and polyline-encoded, deflated, base64url. Opening it never replans (decision
// 2026-11-01: an exact snapshot). New links hold only the trains (tripLink.ts); these still open.
import { decodePolyline, encodePolyline, simplify } from '../polyline';
import { fromB64Url, toB64Url } from '../b64';
import { mergeRepeats, splitLoops } from '../planner/plan';
import { expandLegs, sanitiseTour } from '../tour';
import type { Section } from '../model';
import type { PlannedTrip, Trip } from '../trip';

/** About 100 m (75 m east–west): on the track at the zooms the map is used at, and the
 * timetable stays most of the link (a 3-leg trip: ~4.2k characters, ~6.5k with tracks). */
const TRACK_TOL = 0.001;

const PREFIX = '#/j/';

export async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

type Shared = Omit<Section, 'geometry'> & { track?: string };

/** The trip as shared: no id, no history; tracks simplified and encoded (`track`). */
function slim(t: PlannedTrip) {
  const { id: _id, previous: _p, routeId: _r, ...rest } = t;
  return {
    ...rest,
    chain: {
      ...rest.chain,
      connections: rest.chain.connections.map((c) => ({
        ...c,
        sections: c.sections.map(({ geometry, ...s }): Shared =>
          geometry && geometry.length > 1
            ? { ...s, track: encodePolyline(simplify(geometry, TRACK_TOL)) }
            : s,
        ),
      })),
    },
  };
}

/** Tracks back as geometry (links made before tracks were shared have none: straight lines). */
function full(data: ReturnType<typeof slim>) {
  return {
    ...data,
    chain: {
      ...data.chain,
      connections: data.chain.connections.map((c) => ({
        ...c,
        sections: c.sections.map(({ track, ...s }: Shared): Section =>
          track ? { ...s, geometry: decodePolyline(track) } : s,
        ),
      })),
    },
  };
}

export async function encodeTrip(t: PlannedTrip): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(slim(t)));
  return PREFIX + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeTrip(hash: string, id: string): Promise<Trip | null> {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const bytes = await pipe(
      fromB64Url(hash.slice(PREFIX.length)),
      new DecompressionStream('deflate-raw'),
    );
    return tripFromData(JSON.parse(new TextDecoder().decode(bytes)), id);
  } catch {
    return null;
  }
}

/** A trip from a link's data, checked: a link is someone else's data. Throws if it is odd. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tripFromData(data: any, id: string): Trip | null {
  {
    if (
      data?.schema !== 1 ||
      !data.chain?.connections?.length ||
      !Array.isArray(data.legs) ||
      !Array.isArray(data.route?.waypoints) ||
      typeof data.route?.date !== 'string'
    )
      return null;
    // Every ride with its stops: a damaged or crafted link must not reach the screens (or be
    // saved and synced).
    const stop = (x: unknown) =>
      !!x &&
      typeof (x as { stopRef?: unknown }).stopRef === 'string' &&
      typeof (x as { name?: unknown }).name === 'string';
    const sound = (data.chain.connections as unknown[]).every((c) => {
      const sections = (c as { sections?: unknown }).sections;
      return (
        Array.isArray(sections) &&
        sections.length > 0 &&
        sections.every(
          (s) =>
            stop(s?.from) &&
            stop(s?.to) &&
            Array.isArray(s?.intermediate) &&
            (s.intermediate as unknown[]).every(stop),
        )
      );
    });
    if (!sound) return null;
    const route = sanitiseTour(data.route, data.route.date);
    const time = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
    if (!route || !time(data.chain.dep) || !time(data.chain.arr)) return null;
    // The legs follow from the route, as the planner makes them: never taken from the link.
    const legs = expandLegs(splitLoops(mergeRepeats({ ...route, id })));
    if (legs.length !== data.chain.connections.length) return null;
    const f = full(data);
    // Built from the fields a trip has, nothing else: a link is someone else's data, and the
    // trip is saved and synced (no `previous`, `compact` or unknown keys come along).
    return {
      id,
      version: 1,
      schema: 1,
      name: typeof data.name === 'string' ? data.name.slice(0, 120) : '',
      savedAt: time(data.savedAt) ? data.savedAt : new Date().toISOString(),
      route: { ...route, id: typeof data.route.id === 'string' ? data.route.id : id },
      legs,
      chain: {
        connections: f.chain.connections,
        warnings: Array.isArray(f.chain.warnings) ? f.chain.warnings : [],
        score: typeof f.chain.score === 'number' ? f.chain.score : 0,
        dep: f.chain.dep,
        arr: f.chain.arr,
      },
    } as Trip;
  }
}
