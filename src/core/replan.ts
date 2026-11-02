// "Replan from here" (SPEC "Now"): keep what is travelled, plan the rest from the next place
// one can get off, with the rest of the route editable (a spontaneous stop, a longer stay).
import type { LiveState } from './live';
import type { Connection, Leg, Section, Tour, Waypoint } from './model';
import type { PlannedChain } from './planner/plan';
import { normalise } from './edit';
import { stopKey } from './stops';
import type { PlannedTrip as Trip, TripVersion } from './trip';

export interface ReplanPoint {
  stop: { stopRef: string; name: string };
  /** Earliest time to leave from there, ms. */
  at: number;
  /** The travelled part: whole connections before, the current one cut at `stop`. */
  keep: Connection[];
  /** Index of the planned leg the point lies in. */
  leg: number;
}

/** Where a stop is, [lon, lat], when known (the stop index); trims a cut ride's track. */
export type StopPosition = (key: string) => [number, number] | undefined;

/** Index of the track point nearest `at`, searching from `from` on. */
function nearest(track: [number, number][], at: [number, number], from = 0): number {
  let best = from;
  let dist = Infinity;
  for (let i = from; i < track.length; i++) {
    const [x, y] = track[i]!;
    const d = (x - at[0]) ** 2 + (y - at[1]) ** 2;
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

/**
 * The track up to the point nearest `at`, searched after the point nearest the stop before it
 * (`after`), so a line that passes near the stop earlier (a loop, a spiral) is not cut there.
 * Undefined when there is no track or no position.
 */
function trimTrack(
  track: Section['geometry'],
  at?: [number, number],
  after?: [number, number],
): Section['geometry'] {
  if (!track || track.length < 2 || !at) return undefined;
  const best = nearest(track, at, after ? nearest(track, after) : 0);
  return best >= 1 ? track.slice(0, best + 1) : undefined;
}

/**
 * Cuts a ride at a stop: it ends there, arriving as timetabled. At its own last stop nothing is
 * cut (the track stays whole); elsewhere the track is trimmed at the stop, or dropped when the
 * stop's position is unknown (the map then draws that part straight).
 */
function cutRide(s: Section, key: string, pos?: StopPosition): Section {
  const calls = [s.from, ...s.intermediate, s.to];
  const i = calls.findIndex((c) => stopKey(c.stopRef) === key);
  if (i <= 0 || i === calls.length - 1) return s;
  const end = calls[i]!;
  return {
    ...s,
    to: { ...end, dep: undefined },
    intermediate: s.intermediate.slice(0, i - 1),
    geometry: trimTrack(s.geometry, pos?.(key), pos?.(stopKey(calls[i - 1]!.stopRef))),
  };
}

export function replanPoint(
  trip: Trip,
  state: LiveState,
  now: number,
  pos?: StopPosition,
): ReplanPoint | null {
  if (state.phase === 'done' || !state.rides.length) return null;
  const chain = trip.chain.connections;
  if (state.phase === 'before') {
    const first = state.rides[0]!.stops[0]!;
    return {
      stop: { stopRef: first.key, name: first.name },
      at: Math.max(now, first.dep ?? now),
      keep: [],
      leg: 0,
    };
  }
  const ride = state.rides[state.current]!;
  const stop = state.phase === 'riding' ? ride.stops[(state.between?.i ?? 0) + 1]! : ride.stops[0]!;
  const at = state.phase === 'riding' ? (stop.arr ?? now) : now;
  const c = chain[ride.leg]!;
  // Sections of the current connection up to the point.
  const upTo = state.phase === 'riding' ? ride.section : ride.section - 1;
  const sections = c.sections
    .slice(0, upTo + 1)
    .map((s, i) =>
      i === ride.section && state.phase === 'riding' ? cutRide(s, stop.key, pos) : s,
    );
  const rides = sections.filter((s) => s.mode !== 'walk');
  const cut: Connection[] = rides.length
    ? [
        {
          ...c,
          sections,
          arr: rides.at(-1)!.to.arr ?? c.arr,
          transfers: Math.max(0, rides.length - 1),
        },
      ]
    : [];
  return {
    stop: { stopRef: stop.key, name: stop.name },
    at,
    keep: [...chain.slice(0, ride.leg), ...cut],
    leg: ride.leg,
  };
}

/** The rest of the route from the point: unpassed vias and stops of its leg, then the later legs. */
export function remainingRoute(trip: Trip, point: ReplanPoint): Tour {
  // Stations passed on the current leg only: on a round trip the way back passes stations the
  // way out passed too, and those vias stay.
  const cutLeg = point.keep.length > point.leg ? point.keep[point.leg] : undefined;
  const passed = new Set(
    (cutLeg?.sections ?? []).flatMap((s) =>
      [s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef)),
    ),
  );
  const current = trip.legs[point.leg]!;
  // A planned stay at the point (the end of the current leg, or its start while waiting there)
  // is kept: the rest leaves when the stay is over, not on arrival.
  // Waiting before the leg's first ride, the stay at its start counts even when the point is
  // the bus stop a short walk from the station.
  const key = stopKey(point.stop.stopRef);
  const stay =
    stopKey(current.to.stopRef) === key && cutLeg
      ? current.to.dwellMin
      : point.keep.length === point.leg
        ? current.from.dwellMin
        : 0;
  const arrived = point.keep.length ? Date.parse(point.keep.at(-1)!.arr) : point.at;
  const leave = Math.max(point.at, arrived + stay * 60_000);
  const all: Waypoint[] = [
    ...current.vias.filter((w) => !passed.has(stopKey(w.stopRef))),
    current.to,
    ...trip.legs.slice(point.leg + 1).flatMap((l) => [...l.vias, l.to]),
  ];
  // The point itself starts the rest; only its first appearance goes (a round trip ends there
  // again, and that end stays).
  const first = all.findIndex((w) => stopKey(w.stopRef) === stopKey(point.stop.stopRef));
  const rest = first === 0 ? all.slice(1) : all;
  // Date and time of the point in Zurich: after midnight that is the next day.
  const zurich = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', ...o }).format(leave);
  const local = zurich({ hour: '2-digit', minute: '2-digit' });
  const date = zurich({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const waypoints: Waypoint[] = [
    { ...point.stop, kind: 'start', dwellMin: 0 },
    ...rest.map((w, i) =>
      i === rest.length - 1 ? { ...w, kind: 'end' as const, dwellMin: 0 } : { ...w },
    ),
  ];
  return {
    ...trip.route,
    id: `${trip.id}-replan`,
    date,
    anchor: { departAt: local },
    waypoints,
  };
}

/** The revised trip: the travelled part, then the new plan; warnings re-indexed by leg. */
export function mergeReplan(
  trip: Trip,
  point: ReplanPoint,
  newLegs: Leg[],
  chain: PlannedChain,
): Omit<TripVersion, 'savedAt'> & { legs: Leg[]; chain: PlannedChain } {
  // The stations of the current leg already passed stay on it (the line still shows them).
  const passed = new Set(
    (point.keep[point.leg]?.sections ?? []).flatMap((s) =>
      [s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef)),
    ),
  );
  const keptLegs: Leg[] = trip.legs.slice(0, point.keep.length).map((l, i) =>
    i === point.leg
      ? {
          ...l,
          // The point ends the travelled part: a stay planned there stays; else it is a
          // change (a leg ends there), never a scenic line's station.
          to:
            stopKey(point.stop.stopRef) === stopKey(l.to.stopRef)
              ? { ...l.to, templateId: undefined, ring: undefined, line: undefined }
              : {
                  ...l.to,
                  stopRef: point.stop.stopRef,
                  name: point.stop.name,
                  kind: 'stop',
                  dwellMin: 0,
                  templateId: undefined,
                  ring: undefined,
                  line: undefined,
                },
          vias: l.vias.filter(
            (w) =>
              passed.has(stopKey(w.stopRef)) && stopKey(w.stopRef) !== stopKey(point.stop.stopRef),
          ),
        }
      : l,
  );
  const keptWarnings = trip.chain.warnings.filter((w) => w.legIndex < point.keep.length);
  const offset = point.keep.length;
  const connections = [...point.keep, ...chain.connections];
  // The trip's route as it now runs: what was travelled, then the new rest (its stops, map,
  // shares and "Save as route" all follow the replanned trip). Date and time stay the trip's.
  const legs = [...keptLegs, ...newLegs.map((l, i) => ({ ...l, index: offset + i }))];
  const first = legs[0]?.from;
  const route: Tour = first
    ? {
        ...trip.route,
        waypoints: normalise([first, ...legs.flatMap((l) => [...l.vias, l.to])]),
      }
    : trip.route;
  return {
    route,
    legs,
    chain: {
      connections,
      warnings: [
        ...keptWarnings,
        ...chain.warnings.map((w) => ({ ...w, legIndex: w.legIndex + offset })),
      ],
      score: chain.score,
      dep: connections[0]!.dep,
      arr: connections.at(-1)!.arr,
    },
  };
}
