// Where to put "you" on the map: the time's estimate along the current ride (track when known,
// else straight between its stops), or the device's own location when it is on and good.
import type { LiveState } from './live';
import type { Collection } from './mapdata';
import type { LatLon } from './model';

type Pos = [number, number];
type Polygon = { type: 'Polygon'; coordinates: Pos[][] };

/** The device's location, in memory only: never stored, logged or sent. */
export interface Fix {
  lat: number;
  lon: number;
  /** Metres. */
  accuracy: number;
  /** When it came, ms. */
  at: number;
}

export type Estimate =
  | { kind: 'riding'; pos: Pos; from: string; to: string }
  | { kind: 'waiting'; pos: Pos; at: string };

export type Shown = { source: 'location'; fix: Fix } | { source: 'estimate'; estimate: Estimate };

/** Older than this (a tunnel, a valley) the location gives way to the estimate. */
export const FIX_STALE_MS = 120_000;
/** Rougher than this (a phone mast) it says less than the timetable does. */
export const FIX_ROUGH_M = 1000;
/** A stop on the track lies this close to it; further away the track is not trusted. */
const ON_TRACK_M = 1000;
const NEAR_M = 100;

const M_PER_DEG = 111_320;
/** Metres on a plane, good enough at this size: x east, y north. */
const plane = (lat0: number) => {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: ([lon, lat]: Pos): Pos => [lon * k * M_PER_DEG, lat * M_PER_DEG],
    back: ([x, y]: Pos): Pos => [x / (k * M_PER_DEG), y / M_PER_DEG],
  };
};
const lerp = (a: Pos, b: Pos, f: number): Pos => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
];

/** Closest point of segment a-b to p: how far along it (0…1) and how far off it (metres). */
function closest(p: Pos, a: Pos, b: Pos) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const f = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return { f, off: Math.hypot(p[0] - a[0] - dx * f, p[1] - a[1] - dy * f) };
}

/**
 * Where `p` lies on the track, at `after` or later, as segment + fraction. The first place the
 * track comes near, not simply the nearest: a spiral passes close to a stop more than once.
 */
function locate(track: Pos[], p: Pos, after: number) {
  let best = { at: after, off: Infinity };
  for (let i = Math.min(Math.floor(after), track.length - 2); i + 1 < track.length; i++) {
    const start = track[i]!;
    // Been near, and gone again.
    if (best.off < NEAR_M && Math.hypot(p[0] - start[0], p[1] - start[1]) > best.off + NEAR_M)
      break;
    const c = closest(p, start, track[i + 1]!);
    if (c.off < best.off) best = { at: Math.max(after, i + c.f), off: c.off };
  }
  return best;
}

/** The point `share` of the way along the track from `a` to `b` (segment + fraction, as above). */
function along(track: Pos[], a: number, b: number, share: number): Pos {
  const point = (x: number) =>
    lerp(track[Math.floor(x)]!, track[Math.min(track.length - 1, Math.floor(x) + 1)]!, x % 1);
  const parts: Pos[] = [point(a)];
  for (let i = Math.floor(a) + 1; i <= Math.floor(b); i++) parts.push(track[i]!);
  parts.push(point(b));
  const lengths = parts
    .slice(1)
    .map((q, i) => Math.hypot(q[0] - parts[i]![0], q[1] - parts[i]![1]));
  let left = lengths.reduce((s, l) => s + l, 0) * share;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]! && lengths[i]!)
      return lerp(parts[i]!, parts[i + 1]!, left / lengths[i]!);
    left -= lengths[i]!;
  }
  return parts.at(-1)!;
}

/** The estimate for a trip's state; null before and after it, or with no coordinates to go on. */
export function estimatedPosition(
  state: LiveState,
  stop: (key: string) => LatLon | undefined,
): Estimate | null {
  const ride = state.rides[state.current];
  if (!ride) return null;
  const at = (key: string): Pos | undefined => {
    const p = stop(key);
    return p ? [p.lon, p.lat] : undefined;
  };
  if (state.phase === 'waiting') {
    const here = ride.stops[0]!;
    const pos = at(here.key);
    return pos ? { kind: 'waiting', pos, at: here.name } : null;
  }
  if (state.phase !== 'riding' || !state.between) return null;

  const { i, fraction } = state.between;
  const from = ride.stops[i]!;
  const to = ride.stops[i + 1]!;
  const a = at(from.key);
  const b = at(to.key);
  const riding = (pos: Pos): Estimate => ({ kind: 'riding', pos, from: from.name, to: to.name });
  // A stop the index does not know: the nearest one it does, nothing drawn between.
  if (!a || !b) {
    const known =
      ride.stops
        .slice(0, i + 1)
        .reverse()
        .map((s) => at(s.key))
        .find(Boolean) ??
      ride.stops
        .slice(i + 1)
        .map((s) => at(s.key))
        .find(Boolean);
    return known ? riding(known) : null;
  }

  const straight = riding(lerp(a, b, fraction));
  const geometry = ride.s.geometry;
  if (!geometry || geometry.length < 2) return straight;

  const flat = plane(a[1]);
  const track = geometry.map(flat.to);
  let seg = 0;
  let start = { at: 0, off: 0 };
  let end = { at: 0, off: 0 };
  // From the first stop on: each stop is found after the one before it.
  for (let j = 0; j <= i + 1; j++) {
    const p = at(ride.stops[j]!.key);
    if (!p) continue;
    const found = locate(track, flat.to(p), seg);
    seg = found.at;
    if (j === i) start = found;
    if (j === i + 1) end = found;
  }
  if (start.off > ON_TRACK_M || end.off > ON_TRACK_M) return straight;
  return riding(flat.back(along(track, start.at, end.at, fraction)));
}

/** One marker, never two: the location while it is fresh and good, else the estimate. */
export function shownPosition(
  estimate: Estimate | null,
  fix: Fix | null,
  now: number,
): Shown | null {
  const good = fix && now - fix.at < FIX_STALE_MS && (fix.accuracy <= FIX_ROUGH_M || !estimate);
  if (good) return { source: 'location', fix };
  return estimate ? { source: 'estimate', estimate } : null;
}

/** The circle a fix may be anywhere in, for the map (empty without a fix). */
export function accuracyArea(fix: Fix | null, points = 32): Collection<Polygon> {
  if (!fix) return { type: 'FeatureCollection', features: [] };
  const k = Math.cos((fix.lat * Math.PI) / 180);
  const ring = Array.from({ length: points + 1 }, (_, n): Pos => {
    const angle = (2 * Math.PI * (n % points)) / points;
    return [
      fix.lon + (fix.accuracy * Math.cos(angle)) / (k * M_PER_DEG),
      fix.lat + (fix.accuracy * Math.sin(angle)) / M_PER_DEG,
    ];
  });
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} },
    ],
  };
}
