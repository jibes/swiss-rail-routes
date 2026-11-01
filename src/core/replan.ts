// "Replan from here" (SPEC "Now"): keep what is travelled, plan the rest from the next place
// one can get off, with the rest of the route editable (a spontaneous stop, a longer stay).
import type { LiveState } from './live';
import type { Connection, Leg, Section, Tour, Waypoint } from './model';
import type { PlannedChain } from './planner/plan';
import { stopKey } from './stops';
import type { Trip, TripVersion } from './trip';

export interface ReplanPoint {
  stop: { stopRef: string; name: string };
  /** Earliest time to leave from there, ms. */
  at: number;
  /** The travelled part: whole connections before, the current one cut at `stop`. */
  keep: Connection[];
  /** Index of the planned leg the point lies in. */
  leg: number;
}

/** Cuts a ride at a stop: it ends there, arriving as timetabled. */
function cutRide(s: Section, key: string): Section {
  const calls = [s.from, ...s.intermediate, s.to];
  const i = calls.findIndex((c) => stopKey(c.stopRef) === key);
  if (i <= 0) return s;
  const end = calls[i]!;
  return {
    ...s,
    to: { ...end, dep: undefined },
    intermediate: s.intermediate.slice(0, i - 1),
    geometry: undefined,
  };
}

export function replanPoint(trip: Trip, state: LiveState, now: number): ReplanPoint | null {
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
    .map((s, i) => (i === ride.section && state.phase === 'riding' ? cutRide(s, stop.key) : s));
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
  const passed = new Set(
    point.keep.flatMap((c) =>
      c.sections.flatMap((s) => [s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef))),
    ),
  );
  const current = trip.legs[point.leg]!;
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
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', ...o }).format(point.at);
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
): Omit<TripVersion, 'savedAt'> {
  const keptLegs: Leg[] = trip.legs.slice(0, point.keep.length).map((l, i) =>
    i === point.leg
      ? {
          ...l,
          to: {
            ...l.to,
            stopRef: point.stop.stopRef,
            name: point.stop.name,
            kind: 'via',
            dwellMin: 0,
          },
          vias: [],
        }
      : l,
  );
  const keptWarnings = trip.chain.warnings.filter((w) => w.legIndex < point.keep.length);
  const offset = point.keep.length;
  const connections = [...point.keep, ...chain.connections];
  return {
    route: trip.route,
    legs: [...keptLegs, ...newLegs.map((l, i) => ({ ...l, index: offset + i }))],
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
