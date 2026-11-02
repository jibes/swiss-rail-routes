// Share a trip as its exact timetable (`#/j/<data>`): the trip with its tracks simplified to
// ~100 m and polyline-encoded, deflated, base64url. Opening it never replans (decision
// 2026-11-01: an exact snapshot).
import { decodePolyline, encodePolyline, simplify } from '../polyline';
import type { Section } from '../model';
import type { PlannedTrip, Trip } from '../trip';

/** About 100 m (75 m east–west): on the track at the zooms the map is used at, and the
 * timetable stays most of the link (a 3-leg trip: ~4.2k characters, ~6.5k with tracks). */
const TRACK_TOL = 0.001;

const PREFIX = '#/j/';

const toB64Url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

async function pipe(
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
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (
      data?.schema !== 1 ||
      !data.chain?.connections?.length ||
      !Array.isArray(data.legs) ||
      !Array.isArray(data.route?.waypoints) ||
      typeof data.route?.date !== 'string'
    )
      return null;
    // Every ride with its two ends: a damaged link must not reach the timetable view.
    const sound = (data.chain.connections as unknown[]).every(
      (c) =>
        Array.isArray((c as { sections?: unknown }).sections) &&
        (
          c as { sections: { from?: { name?: unknown }; to?: { name?: unknown } }[] }
        ).sections.every(
          (s) => typeof s?.from?.name === 'string' && typeof s?.to?.name === 'string',
        ),
    );
    if (!sound || data.legs.length !== data.chain.connections.length) return null;
    return { ...full(data), id, version: 1 } as Trip;
  } catch {
    return null;
  }
}
