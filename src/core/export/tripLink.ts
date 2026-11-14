// Share a trip as its trains (`#/s/<data>`): the route and each ride's train, stops and times.
// Since 0.21.0 packed as numbers (tripLinkPacked.ts); until then JSON, deflated, base64url, still
// read here. A few hundred characters, so messengers leave it whole (the whole
// timetable, `#/j/`, ran to 5,600, and they cut it off). What anyone can get again is left out:
// station names come from the app's own list, the rest from OJP when it opens (core/refresh.ts).
import { asStay, type OldWaypoint } from '../stay';
import { fromB64Url, toB64Url } from '../b64';
import type { Mode, Section, WaypointKind } from '../model';
import { changesOf, type PlannedTrip, type Trip } from '../trip';
import { decodePacked, encodePacked } from './tripLinkPacked';
import { pipe, tripFromData } from './tripShare';

const PREFIX = '#/s/';
const KINDS: WaypointKind[] = ['start', 'via', 'stop', 'turnaround', 'end'];
const MODES: (Mode | 'walk')[] = ['rail', 'cog', 'cableCar', 'boat', 'bus', 'walk'];
const SLOID = 'ch:1:sloid:';
const SJYID = 'ch:1:sjyid:';

/** The name the app has for a stop, if it has it (`index.byRef(stopKey(ref))?.name`). */
export type NameOf = (ref: string) => string | undefined;

const shortRef = (r: string) => (r.startsWith(SLOID) ? r.slice(SLOID.length) : `!${r}`);
const longRef = (r: string) => (r.startsWith('!') ? r.slice(1) : SLOID + r);

/** Trailing "nothing" dropped: most fields are empty on most rows. */
const row = (...xs: unknown[]) => {
  let n = xs.length;
  while (n > 1 && (xs[n - 1] === 0 || xs[n - 1] === undefined || xs[n - 1] === '')) n--;
  return xs.slice(0, n).map((x) => x ?? 0);
};
const text = (x: unknown) => (typeof x === 'string' ? x : undefined);
const hhmm = (x: unknown) =>
  typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : undefined;

/** The link to send: the compact form (0.21.0, `tripLinkPacked.ts`). */
export async function encodeTripLink(t: PlannedTrip, nameOf: NameOf): Promise<string> {
  return PREFIX + (await encodePacked(t, nameOf));
}

/** The link as written until 0.20.0: JSON, deflated. Kept for tests of old links. */
export async function encodeTripLinkV1(t: PlannedTrip, nameOf: NameOf): Promise<string> {
  const { route, chain } = t;
  const base = Date.parse(`${route.date}T00:00:00Z`);
  /** Minutes from the trip's day: no time zones or repeated dates in the link. */
  const min = (iso?: string) => (iso ? (Date.parse(iso) - base) / 60_000 : undefined);
  const own = (ref: string, name: string) => (nameOf(ref) === name ? 0 : name);
  // Walks start with a number (their minutes), rides with their journey: '' when it has none.
  const journey = (j?: string) => {
    if (!j) return '';
    const day = `${route.date}:`;
    const rest = j.startsWith(day) ? j.slice(day.length) : `!${j}`;
    return rest.startsWith(SJYID) ? rest.slice(SJYID.length) : `~${rest}`;
  };
  const end = (e: Section['from'], at?: string) =>
    row(shortRef(e.stopRef), min(at), e.platform, own(e.stopRef, e.name));
  const data = [
    1,
    t.name,
    route.name,
    route.date,
    'departAt' in route.anchor ? `d${route.anchor.departAt}` : `a${route.anchor.arriveBy}`,
    route.ticket,
    route.travelClass,
    route.waypoints.map((w) =>
      row(
        shortRef(w.stopRef),
        KINDS.indexOf(w.kind),
        w.dwellMin,
        own(w.stopRef, w.name),
        w.templateId,
        w.line,
        w.ring ? 1 : 0,
      ),
    ),
    chain.connections.map((c) => [
      min(c.dep),
      min(c.arr),
      c.sections.map((s) =>
        s.mode === 'walk'
          ? [s.walkMin ?? 0, end(s.from), end(s.to)]
          : row(
              journey(s.journey),
              MODES.indexOf(s.mode),
              end(s.from, s.from.dep),
              end(s.to, s.to.arr),
              s.category,
              s.line,
              s.number,
              s.product,
              (s.reservationRequired ? 1 : 0) + (s.supplement ? 2 : 0),
            ),
      ),
    ]),
  ];
  const json = new TextEncoder().encode(JSON.stringify(data));
  return PREFIX + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/**
 * The trip as far as the link holds it, checked like any link; `null` if it is damaged or cut
 * short. The compact form first (its CRC tells), then the JSON one of 0.12–0.20, also with the
 * `-` or `_` a messenger may have dropped from its end put back.
 */
export async function decodeTripLink(
  hash: string,
  id: string,
  nameOf: NameOf,
): Promise<Trip | null> {
  if (!hash.startsWith(PREFIX)) return null;
  const data = hash.slice(PREFIX.length);
  const packed = await decodePacked(data, id, nameOf);
  if (packed !== undefined) return packed;
  for (const d of [data, `${data}-`, `${data}_`]) {
    const t = await decodeV1(d, id, nameOf);
    if (t) return t;
  }
  return null;
}

async function decodeV1(data: string, id: string, nameOf: NameOf): Promise<Trip | null> {
  try {
    const bytes = await pipe(fromB64Url(data), new DecompressionStream('deflate-raw'));
    const [v, name, routeName, date, anchor, ticket, travelClass, waypoints, connections] =
      JSON.parse(new TextDecoder().decode(bytes)) as unknown[];
    if (v !== 1 || typeof date !== 'string' || typeof anchor !== 'string') return null;
    const base = Date.parse(`${date}T00:00:00Z`);
    const at = (m: unknown) =>
      typeof m === 'number'
        ? new Date(base + m * 60_000).toISOString().replace('.000', '')
        : undefined;
    const journey = (j: unknown) => {
      if (typeof j !== 'string' || !j) return undefined;
      const long = j.startsWith('~') ? j.slice(1) : SJYID + j;
      return long.startsWith('!') ? long.slice(1) : `${date}:${long}`;
    };
    const named = (ref: string, own: unknown) => text(own) ?? nameOf(ref) ?? '';
    const stop = (e: unknown[], time?: 'arr' | 'dep') => {
      if (typeof e[0] !== 'string' && typeof e[0] !== 'number') throw new Error('stop');
      const ref = longRef(String(e[0]));
      const when = at(e[1]);
      return {
        stopRef: ref,
        name: named(ref, e[3]),
        ...(time && when ? { [time]: when } : {}),
        ...(text(e[2]) ? { platform: text(e[2]) } : {}),
      };
    };
    const section = (s: unknown[]): Section =>
      typeof s[0] === 'number'
        ? {
            mode: 'walk',
            walkMin: s[0],
            from: stop(s[1] as unknown[]),
            to: stop(s[2] as unknown[]),
            intermediate: [],
          }
        : {
            mode: MODES[s[1] as number] as Mode,
            journey: journey(s[0]),
            from: stop(s[2] as unknown[], 'dep'),
            to: stop(s[3] as unknown[], 'arr'),
            intermediate: [],
            ...(text(s[4]) ? { category: text(s[4]) } : {}),
            ...(text(s[5]) ? { line: text(s[5]) } : {}),
            ...(text(s[6]) ? { number: text(s[6]) } : {}),
            ...(text(s[7]) ? { product: text(s[7]) } : {}),
            ...(((s[8] as number) & 1) === 1 ? { reservationRequired: true } : {}),
            ...(((s[8] as number) & 2) === 2 ? { supplement: true } : {}),
          };
    const conns = (connections as unknown[][]).map((c, i) => {
      const sections = (c[2] as unknown[][]).map(section);
      return {
        legIndex: i,
        dep: at(c[0]),
        arr: at(c[1]),
        transfers: changesOf([{ sections }]),
        sections,
      };
    });
    const way = (w: unknown[]): OldWaypoint => {
      const ref = longRef(String(w[0]));
      return {
        stopRef: ref,
        name: named(ref, w[3]),
        kind: KINDS[w[1] as number] ?? 'via',
        dwellMin: typeof w[2] === 'number' ? w[2] : 0,
        ...(text(w[4]) ? { templateId: text(w[4]) } : {}),
        ...(text(w[5]) ? { line: text(w[5]) } : {}),
        ...(w[6] === 1 ? { ring: true } : {}),
        // Slots 7 and 8 (arrive no earlier, leave no later) were written until 0.15.0: read past.
        // Slots 9 and 10 (come after, leave by) until 0.67.0: leave by read as a stay until.
        ...(hhmm(w[9]) ? { arriveAfter: hhmm(w[9]) } : {}),
        ...(hhmm(w[10]) ? { leaveBy: hhmm(w[10]) } : {}),
      } as OldWaypoint;
    };
    const when = anchor.slice(1);
    return tripFromData(
      {
        schema: 1,
        name,
        savedAt: new Date().toISOString(),
        route: {
          id,
          name: typeof routeName === 'string' ? routeName : '',
          date,
          anchor: anchor.startsWith('a') ? { arriveBy: when } : { departAt: when },
          ticket,
          travelClass,
          waypoints: (waypoints as unknown[][]).map((w) => asStay(way(w), date)),
          schema: 1,
        },
        legs: [],
        chain: {
          connections: conns,
          warnings: [],
          score: 0,
          dep: conns[0]?.dep,
          arr: conns.at(-1)?.arr,
        },
      },
      id,
    );
  } catch {
    return null;
  }
}
