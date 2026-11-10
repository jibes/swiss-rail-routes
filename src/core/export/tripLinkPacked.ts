// The compact `#/s/` link (0.21.0; the format is in tripPack.ts): about a third of the JSON form's
// length. Encoded here; tripLink.ts tries it first when a link opens.
import { fromB64Url, toB64Url } from '../b64';
import type { Mode, Section, StopCall, TicketType, Waypoint, WaypointKind } from '../model';
import { stopKey } from '../stops';
import { changesOf, type PlannedTrip, type Trip } from '../trip';
import {
  LINK_END,
  Reader,
  Writer,
  crc16,
  journeyNumber,
  readJourney,
  readRef,
  writeJourney,
  writeRef,
} from './tripPack';
import { pipe, tripFromData } from './tripShare';

/** The name the app has for a stop, if it has it. */
type NameOf = (ref: string) => string | undefined;

const KINDS: WaypointKind[] = ['start', 'via', 'stop', 'turnaround', 'end'];
const MODES: (Mode | 'walk')[] = ['rail', 'cog', 'cableCar', 'boat', 'bus', 'walk'];
const TICKETS: TicketType[] = ['GA', 'Tageskarte', 'Halbtax', 'none'];
/** Days are counted from here: small numbers for the years the app is used in. */
const EPOCH = Date.parse('2020-01-01T00:00:00Z');
/** v1 (0.21.0) holds every ride's journey; v2 (0.22.6) only those two rides share, as the rest
 * come back when the link opens (refresh.ts finds a ride by its stations and time). */
const HEADER_V1 = 0x20;
const HEADER = 0x30;
const DEFLATED = 1;

const hm = (s: string) => {
  const m = /^(\d\d):(\d\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (n: number) => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;
/** A stay's end (`YYYY-MM-DDTHH:MM`) as minutes from the trip's day, and back (0.44.0). */
const untilMin = (v: string, date: string) =>
  Math.round(
    (Date.parse(`${v.slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 60_000,
  ) + hm(v.slice(11, 16));
const untilOf = (n: number, date: string) =>
  `${new Date(Date.parse(`${date}T00:00:00Z`) + Math.floor(n / 1440) * 86_400_000).toISOString().slice(0, 10)}T${hhmm(n % 1440)}`;

export async function encodePacked(t: PlannedTrip, nameOf: NameOf): Promise<string> {
  const { route, chain } = t;
  const base = Date.parse(`${route.date}T00:00:00Z`);
  const min = (iso?: string) => (iso ? Math.round((Date.parse(iso) - base) / 60_000) : undefined);

  const stops: { ref: string; name: string }[] = [];
  const stopAt = new Map<string, number>();
  // Ride ends by their station, not the platform's own id: refresh asks by station and brings the
  // platforms back, and one station is then one entry for the route and every ride through it.
  const stop = (ref: string, name: string) => {
    let i = stopAt.get(ref);
    if (i === undefined) {
      i = stops.push({ ref, name }) - 1;
      stopAt.set(ref, i);
    }
    return i;
  };
  const strings: string[] = [];
  const strAt = new Map<string, number>();
  const body = new Writer();
  /** 0 for none, else the string's place in the table + 1. */
  const strRef = (s?: string) => {
    if (!s) return body.uv(0);
    let i = strAt.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      strAt.set(s, i);
    }
    body.uv(i + 1);
  };
  // Operators (`100001`) in their own table, as numbers.
  const ops: string[] = [];
  const opRef = (s: string) => {
    let i = ops.indexOf(s);
    if (i < 0) i = ops.push(s) - 1;
    body.uv(i);
  };

  // A waypoint in one byte mostly: its kind, where its line tag comes from (none, its own line, the
  // waypoint before's, or written), a ring, whether its stop is one met before (else the table's
  // next); stays, lines and windows in a second number.
  body.uv(route.waypoints.length);
  let prevTpl: string | undefined;
  for (const w of route.waypoints) {
    const known = stopAt.has(w.stopRef);
    const at = stop(w.stopRef, w.name);
    const tplMode = !w.templateId
      ? 0
      : w.templateId === w.line
        ? 1
        : w.templateId === prevTpl
          ? 2
          : 3;
    const rare =
      (w.dwellMin > 0 ? 1 : 0) |
      (w.line ? 2 : 0) |
      (w.arriveAfter ? 4 : 0) |
      (w.leaveBy ? 8 : 0) |
      (w.stayUntil ? 16 : 0);
    body.uv(
      Math.max(0, KINDS.indexOf(w.kind)) |
        (tplMode << 3) |
        (w.ring ? 32 : 0) |
        (known ? 64 : 0) |
        (rare ? 128 : 0),
    );
    if (known) body.uv(at);
    if (rare) body.uv(rare);
    if (rare & 1) body.uv(Math.round(w.dwellMin));
    if (tplMode === 3) strRef(w.templateId);
    if (w.line) strRef(w.line);
    if (w.arriveAfter) body.uv(hm(w.arriveAfter));
    if (w.leaveBy) body.uv(hm(w.leaveBy));
    if (w.stayUntil) body.uv(Math.max(0, untilMin(w.stayUntil, route.date)));
    prevTpl = w.templateId;
  }

  // Times as minute steps: from the last time said, a ride's arrival as its duration.
  let cursor = 0;
  const step = (iso?: string) => {
    const m = min(iso) ?? cursor;
    body.sv(m - cursor);
    cursor = m;
  };
  const duration = (iso?: string) => {
    const m = Math.max(cursor, min(iso) ?? cursor);
    body.uv(m - cursor);
    cursor = m;
  };
  /** Where the last section ended: the next one starting there says so with a bit, not a stop. */
  let last = -1;
  // A journey only where the next ride is the same train (it runs on: no change), written once,
  // the next ride saying "the same as before". The others come back when the link opens.
  const allRides = chain.connections.flatMap((c) => c.sections).filter((x) => x.mode !== 'walk');
  const runsOnNext = new Set<Section>();
  const runsOnPrev = new Set<Section>();
  allRides.forEach((x, i) => {
    const n = allRides[i + 1];
    if (x.journey && n && n.journey === x.journey) {
      runsOnNext.add(x);
      runsOnPrev.add(n);
    }
  });
  // A connection's times where its rides do not give them: a walk at its start or end.
  const firstRide = (c: (typeof chain.connections)[number]) => c.sections[0]?.mode !== 'walk';
  const lastRide = (c: (typeof chain.connections)[number]) => c.sections.at(-1)?.mode !== 'walk';
  body.uv(chain.connections.length);
  for (const c of chain.connections) {
    const ownDep = !(firstRide(c) && c.sections[0]!.from.dep === c.dep);
    const ownArr = !(lastRide(c) && c.sections.at(-1)!.to.arr === c.arr);
    body.uv(c.sections.length * 4 + (ownDep ? 1 : 0) + (ownArr ? 2 : 0));
    if (ownDep) step(c.dep);
    for (const s of c.sections) {
      const ride = s.mode !== 'walk';
      const from = stop(stopKey(s.from.stopRef), s.from.name);
      const to = stop(stopKey(s.to.stopRef), s.to.name);
      const copy = runsOnPrev.has(s);
      const write = !copy && runsOnNext.has(s);
      const extras = (s.reservationRequired ? 1 : 0) | (s.supplement ? 2 : 0) | (copy ? 4 : 0);
      body.uv(
        Math.max(0, MODES.indexOf(s.mode)) |
          // A ride's journey written; a walk's: it stays at the station (between two platforms).
          ((ride ? write : to === from) ? 8 : 0) |
          (from === last ? 16 : 0) |
          (ride && (write || copy) && !!s.number && s.number === journeyNumber(s.journey)
            ? 32
            : 0) |
          (extras ? 64 : 0),
      );
      if (extras) body.uv(extras);
      if (!ride) body.uv(Math.max(0, Math.round(s.walkMin ?? 0)));
      else if (write) writeJourney(body, s.journey!, route.date, opRef);
      if (from !== last) body.uv(from);
      if (ride) step(s.from.dep);
      if (ride || to !== from) body.uv(to);
      if (ride) {
        duration(s.to.arr);
        // Category and line as one entry; the line alone where the category is its letters
        // ("IR38" is an IR).
        const cat = s.category ?? '';
        // A train without a line goes by its number: its journey, which held it, is left out.
        const kept = write || copy;
        const line = s.line ?? (!kept && s.number ? s.number : '');
        strRef(
          !cat && !line
            ? undefined
            : cat && /^[A-Za-z]+/.exec(line)?.[0] === cat && !line.includes('\t')
              ? line
              : `${cat}\t${line}`,
        );
      }
      last = to;
    }
    if (ownArr) step(c.arr);
  }

  const out = new Writer();
  const routeName = route.name !== t.name;
  const arrive = 'arriveBy' in route.anchor;
  out.uv(
    (routeName ? 1 : 0) |
      (arrive ? 2 : 0) |
      (Math.max(0, TICKETS.indexOf(route.ticket)) << 2) |
      (route.travelClass === 1 ? 16 : 0),
  );
  out.str(t.name);
  if (routeName) out.str(route.name);
  out.uv(Math.round((Date.parse(`${route.date}T00:00:00Z`) - EPOCH) / 86_400_000));
  out.uv(hm('arriveBy' in route.anchor ? route.anchor.arriveBy : route.anchor.departAt));
  out.uv(stops.length);
  for (const s of stops) {
    // The name, only where it is not the app's own for the stop (a bus stand, a renamed one).
    const named = nameOf(s.ref) !== s.name;
    writeRef(out, s.ref, named);
    if (named) out.str(s.name);
  }
  out.uv(strings.length);
  for (const s of strings) out.str(s);
  out.uv(ops.length);
  for (const o of ops)
    if (/^[1-9]\d{0,14}$/.test(o)) out.uv(Number(o) * 2);
    else {
      out.uv(1);
      out.str(o);
    }
  const raw = Uint8Array.from([...out.bytes, ...body.bytes]);
  const deflated = await pipe(raw, new CompressionStream('deflate-raw'));
  const packed = deflated.length < raw.length ? deflated : raw;
  const bytes = [HEADER | (packed === deflated ? DEFLATED : 0), ...packed];
  const crc = crc16(bytes);
  bytes.push(crc >> 8, crc & 0xff);
  return toB64Url(Uint8Array.from(bytes)) + LINK_END;
}

/**
 * The trip a compact link holds: `undefined` when the text is not one (an older link), `null`
 * when it is one but damaged or cut short, so no wrong trip is ever shown.
 */
export async function decodePacked(
  data: string,
  id: string,
  nameOf: NameOf,
): Promise<Trip | null | undefined> {
  if (!data.endsWith(LINK_END) || data.length < 6) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = fromB64Url(data.slice(0, -LINK_END.length));
  } catch {
    return undefined;
  }
  const version = bytes[0]! & 0xf0;
  if (bytes.length < 4 || (version !== HEADER && version !== HEADER_V1)) return undefined;
  const crc = (bytes[bytes.length - 2]! << 8) | bytes[bytes.length - 1]!;
  if (crc16(bytes.subarray(0, -2)) !== crc) return undefined;
  try {
    const payload = bytes.slice(1, -2);
    const raw =
      bytes[0]! & DEFLATED ? await pipe(payload, new DecompressionStream('deflate-raw')) : payload;
    return read(new Reader(raw), id, nameOf, version === HEADER ? 2 : 1);
  } catch {
    return null;
  }
}

function read(r: Reader, id: string, nameOf: NameOf, v: 1 | 2): Trip | null {
  const flags = r.uv();
  const name = r.str();
  const routeName = flags & 1 ? r.str() : name;
  const date = new Date(EPOCH + r.uv() * 86_400_000).toISOString().slice(0, 10);
  const anchorAt = hhmm(r.uv());
  const ticket = TICKETS[(flags >> 2) & 3]!;
  const travelClass = flags & 16 ? 1 : 2;
  const stops = Array.from({ length: r.uv() }, () => {
    const { ref, named } = readRef(r);
    return { stopRef: ref, name: named ? r.str() : (nameOf(ref) ?? '') };
  });
  const strings = Array.from({ length: r.uv() }, () => r.str());
  const ops = Array.from({ length: r.uv() }, () => {
    const v = r.uv();
    return v % 2 ? r.str() : String(v / 2);
  });
  const opOf = () => {
    const o = ops[r.uv()];
    if (o === undefined) throw new Error('operator');
    return o;
  };
  const stopOf = () => {
    const s = stops[r.uv()];
    if (!s) throw new Error('stop');
    return s;
  };
  const str = () => {
    const i = r.uv();
    if (i > strings.length) throw new Error('string');
    return i ? strings[i - 1] : undefined;
  };

  let next = 0;
  let prevTpl: string | undefined;
  const waypoints = Array.from({ length: r.uv() }, (): Waypoint => {
    const f = r.uv();
    const s = f & 64 ? stopOf() : stops[next++];
    if (!s) throw new Error('stop');
    const rare = f & 128 ? r.uv() : 0;
    const dwellMin = rare & 1 ? r.uv() : 0;
    const tplMode = (f >> 3) & 3;
    const own = tplMode === 3 ? str() : undefined;
    const line = rare & 2 ? str() : undefined;
    const arriveAfter = rare & 4 ? hhmm(r.uv()) : undefined;
    const leaveBy = rare & 8 ? hhmm(r.uv()) : undefined;
    const stayUntil = rare & 16 ? untilOf(r.uv(), date) : undefined;
    const tpl = [undefined, line, prevTpl, own][tplMode];
    prevTpl = tpl;
    return {
      stopRef: s.stopRef,
      name: s.name,
      kind: KINDS[f & 7] ?? 'via',
      dwellMin,
      ...(tpl ? { templateId: tpl } : {}),
      ...(line ? { line } : {}),
      ...(f & 32 ? { ring: true } : {}),
      ...(arriveAfter ? { arriveAfter } : {}),
      ...(leaveBy ? { leaveBy } : {}),
      ...(stayUntil ? { stayUntil } : {}),
    };
  });

  const base = Date.parse(`${date}T00:00:00Z`);
  const iso = (m: number) => new Date(base + m * 60_000).toISOString().replace('.000', '');
  let cursor = 0;
  const step = () => (cursor += r.sv());
  const duration = () => (cursor += r.uv());
  const at = (s: { stopRef: string; name: string }) => ({ stopRef: s.stopRef, name: s.name });
  let last: { stopRef: string; name: string } | undefined;
  /** The last ride's journey: v2's "the same train as before". */
  let prevJourney: string | undefined;

  const connections = Array.from({ length: r.uv() }, (_, legIndex) => {
    const shape = r.uv();
    let dep = shape & 1 ? iso(step()) : undefined;
    const sections = Array.from({ length: Math.floor(shape / 4) }, (): Section => {
      const head = r.uv();
      const mode = MODES[head & 7];
      if (!mode) throw new Error('mode');
      const extras = head & 64 ? r.uv() : 0;
      const walk = mode === 'walk';
      const walkMin = walk ? r.uv() : undefined;
      const journey = walk
        ? undefined
        : head & 8
          ? readJourney(r, date, opOf)
          : v === 2 && extras & 4
            ? prevJourney
            : undefined;
      if (v === 2 && extras & 4 && !journey) throw new Error('journey');
      if (!walk) prevJourney = journey;
      const fromStop = head & 16 ? last : stopOf();
      if (!fromStop) throw new Error('from');
      if (walk) {
        const toStop = head & 8 ? fromStop : stopOf();
        last = toStop;
        return { mode, walkMin, from: at(fromStop), to: at(toStop), intermediate: [] };
      }
      const depAt = iso(step());
      const toStop = stopOf();
      last = toStop;
      const arrAt = iso(duration());
      const pair = str();
      const [category, line] = !pair
        ? [undefined, undefined]
        : pair.includes('\t')
          ? pair.split('\t')
          : [/^[A-Za-z]+/.exec(pair)?.[0], pair];
      const number = head & 32 ? journeyNumber(journey) : undefined;
      return {
        mode,
        ...(journey ? { journey } : {}),
        from: { ...at(fromStop), dep: depAt } as StopCall,
        to: { ...at(toStop), arr: arrAt } as StopCall,
        intermediate: [],
        ...(category ? { category } : {}),
        ...(line ? { line } : {}),
        ...(number ? { number } : {}),
        ...(extras & 1 ? { reservationRequired: true } : {}),
        ...(extras & 2 ? { supplement: true } : {}),
      };
    });
    dep ??= sections[0]?.from.dep;
    const arr = shape & 2 ? iso(step()) : sections.at(-1)?.to.arr;
    if (!dep || !arr) throw new Error('times');
    return { legIndex, dep, arr, transfers: changesOf([{ sections }]), sections };
  });
  if (!r.done) return null;

  return tripFromData(
    {
      schema: 1,
      name,
      savedAt: new Date().toISOString(),
      route: {
        id,
        name: routeName,
        date,
        anchor: flags & 2 ? { arriveBy: anchorAt } : { departAt: anchorAt },
        ticket,
        travelClass,
        waypoints,
        schema: 1,
      },
      legs: [],
      chain: {
        connections,
        warnings: [],
        score: 0,
        dep: connections[0]?.dep,
        arr: connections.at(-1)?.arr,
      },
    },
    id,
  );
}
