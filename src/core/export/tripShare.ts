// Share a trip as its exact timetable (`#/j/<data>`): the trip without track geometry, deflated,
// base64url. Opening it never replans (decision 2026-11-01: an exact snapshot).
import type { Trip } from '../trip';

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

/** The trip as shared: no id, no history, no tracks (the map draws straight lines instead). */
function slim(t: Trip) {
  const { id: _id, previous: _p, routeId: _r, ...rest } = t;
  return {
    ...rest,
    chain: {
      ...rest.chain,
      connections: rest.chain.connections.map((c) => ({
        ...c,
        sections: c.sections.map(({ geometry: _g, ...s }) => s),
      })),
    },
  };
}

export async function encodeTrip(t: Trip): Promise<string> {
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
    if (data?.schema !== 1 || !data.chain?.connections?.length || !Array.isArray(data.legs))
      return null;
    return { ...data, id, version: 1 } as Trip;
  } catch {
    return null;
  }
}
