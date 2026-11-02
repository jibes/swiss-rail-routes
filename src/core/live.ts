// Where a trip stands at a moment: from its connections, the time, and live calls (OJP TripInfo)
// when known. Position comes from the timetable only (no GPS, SPEC "Now").
import type { Connection, Section, StopCall } from './model';
import type { JourneyStatus, LiveCall } from './ojp/journey';
import { isTight, walkMinutes } from './planner/connection';
import { stopKey } from './stops';

export interface LiveStop {
  key: string;
  name: string;
  /** Planned and expected (live, else planned) times, ms. */
  arr?: number;
  dep?: number;
  arrPlan?: number;
  depPlan?: number;
  platform?: string;
  cancelled: boolean;
}

export interface LiveRide {
  leg: number;
  section: number;
  s: Section;
  stops: LiveStop[];
  cancelled: boolean;
}

export type Phase = 'before' | 'riding' | 'waiting' | 'done';

export interface Risk {
  /** Index into `rides` of the ride whose connection is at risk (the one to catch). */
  ride: number;
  marginMin: number;
  /** `notServed`: the train runs but no longer stops where you get on or off (`stop`). */
  reason: 'tight' | 'missed' | 'cancelled' | 'notServed';
  stop?: string;
}

export interface LiveState {
  phase: Phase;
  rides: LiveRide[];
  /** The ride being travelled (riding) or the next one (before/waiting). */
  current: number;
  /** Riding: between stops[i] and stops[i+1] of the current ride, `fraction` of the way. */
  between?: { i: number; fraction: number };
  /** The whole trip, 0…1 by time. */
  progress: number;
  next?: { kind: 'board' | 'alight'; ride: number; stop: LiveStop; at: number; delayMin: number };
  risks: Risk[];
}

const ms = (iso?: string) => (iso ? Date.parse(iso) : undefined);

function liveStop(c: StopCall & { platform?: string }, live?: LiveCall): LiveStop {
  const arrPlan = ms(c.arr);
  const depPlan = ms(c.dep);
  return {
    key: stopKey(c.stopRef),
    name: c.name,
    arrPlan,
    depPlan,
    arr: ms(live?.arrEst) ?? arrPlan,
    dep: ms(live?.depEst) ?? depPlan,
    platform: live?.platform ?? c.platform,
    cancelled: live?.cancelled ?? false,
  };
}

/** Every ride of the trip with its stops, live times merged in where the vehicle reported them. */
export function liveRides(chain: Connection[], status: Map<string, JourneyStatus>): LiveRide[] {
  return chain.flatMap((c, leg) =>
    c.sections.flatMap((s, section): LiveRide[] => {
      if (s.mode === 'walk') return [];
      const st = s.journey ? status.get(s.journey) : undefined;
      const byKey = new Map(st?.calls.map((x) => [x.key, x]) ?? []);
      const calls = [s.from, ...s.intermediate, s.to];
      return [
        {
          leg,
          section,
          s,
          stops: calls.map((x) => liveStop(x, byKey.get(stopKey(x.stopRef)))),
          cancelled: st?.cancelled ?? false,
        },
      ];
    }),
  );
}

/** Minutes of planned walking between two rides, across a leg's end too (walks at the end of
 * one connection and the start of the next, at a change without a stay). */
function walkMin(chain: Connection[], a: LiveRide, b: LiveRide): number {
  const walks =
    a.leg === b.leg
      ? chain[a.leg]!.sections.slice(a.section + 1, b.section)
      : [
          ...chain[a.leg]!.sections.slice(a.section + 1),
          ...chain[b.leg]!.sections.slice(0, b.section),
        ];
  return walks.reduce((m, s) => m + (s.mode === 'walk' ? walkMinutes(s) : 0), 0);
}

const depOf = (r: LiveRide) => r.stops[0]!.dep ?? r.stops[0]!.depPlan ?? 0;
const arrOf = (r: LiveRide) => r.stops.at(-1)!.arr ?? r.stops.at(-1)!.arrPlan ?? 0;
const delay = (expected?: number, plan?: number) =>
  expected !== undefined && plan !== undefined ? Math.round((expected - plan) / 60_000) : 0;

export function liveState(
  chain: Connection[],
  now: number,
  status: Map<string, JourneyStatus> = new Map(),
): LiveState {
  const rides = liveRides(chain, status);
  const risks: Risk[] = [];
  /**
   * The first ride you cannot be on (missed, cancelled, or not stopping where you board): you
   * stay where it would have left from until you replan, however late it gets, and nothing
   * after it counts.
   */
  let stuck: number | undefined;
  for (let i = 0; i < rides.length && stuck === undefined; i++) {
    const b = rides[i]!;
    const a = rides[i - 1];
    const sameVehicle = !!a && !!a.s.journey && a.s.journey === b.s.journey;
    const walk = a && !sameVehicle ? walkMin(chain, a, b) : 0;
    const margin = a && !sameVehicle ? (depOf(b) - arrOf(a)) / 60_000 : Infinity;
    const boardGone = b.stops[0]!.cancelled;
    if (b.cancelled || boardGone || margin < walk) {
      // Before boarding, or never boarded: lost. A ride long over was ridden.
      if (arrOf(b) <= now && !b.cancelled && !boardGone && margin >= 0) continue;
      risks.push(
        b.cancelled
          ? { ride: i, marginMin: 0, reason: 'cancelled' }
          : boardGone
            ? { ride: i, marginMin: 0, reason: 'notServed', stop: b.stops[0]!.name }
            : { ride: i, marginMin: Math.round(margin), reason: 'missed' },
      );
      stuck = i;
      break;
    }
    if (arrOf(b) <= now) continue;
    // The exit not served: said; you are on board (or will be) all the same.
    if (b.stops.at(-1)!.cancelled)
      risks.push({ ride: i, marginMin: 0, reason: 'notServed', stop: b.stops.at(-1)!.name });
    // Tight only while the change is still ahead.
    else if (a && !sameVehicle && depOf(b) > now && isTight(margin, walk))
      risks.push({ ride: i, marginMin: Math.round(margin), reason: 'tight' });
  }
  if (!rides.length) return { phase: 'done', rides, current: 0, progress: 1, risks };

  const start = depOf(rides[0]!);
  const end = arrOf(rides.at(-1)!);
  const progress = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
  const board = (i: number) => {
    const stop = rides[i]!.stops[0]!;
    return {
      kind: 'board' as const,
      ride: i,
      stop,
      at: depOf(rides[i]!),
      delayMin: delay(stop.dep, stop.depPlan),
    };
  };
  const alight = (i: number) => {
    const stop = rides[i]!.stops.at(-1)!;
    return {
      kind: 'alight' as const,
      ride: i,
      stop,
      at: arrOf(rides[i]!),
      delayMin: delay(stop.arr, stop.arrPlan),
    };
  };

  if (now < start) return { phase: 'before', rides, current: 0, progress, next: board(0), risks };
  for (let i = 0; i < rides.length; i++) {
    const r = rides[i]!;
    // A ride you cannot be on: you wait where it would have taken you from (replan from here).
    if (now < depOf(r) || i === stuck)
      return { phase: 'waiting', rides, current: i, progress, next: board(i), risks };
    if (now < arrOf(r)) {
      const times = r.stops.map((x) => x.dep ?? x.arr ?? 0);
      let j = 0;
      while (j + 1 < times.length - 1 && now >= (r.stops[j + 1]!.arr ?? times[j + 1]!)) j++;
      const from = r.stops[j]!.dep ?? r.stops[j]!.arr ?? times[j]!;
      const to = r.stops[j + 1]!.arr ?? r.stops[j + 1]!.dep ?? times[j + 1]!;
      const fraction = Math.min(1, Math.max(0, (now - from) / Math.max(1, to - from)));
      return {
        phase: 'riding',
        rides,
        current: i,
        between: { i: j, fraction },
        progress,
        next: alight(i),
        risks,
      };
    }
  }
  return { phase: 'done', rides, current: rides.length - 1, progress: 1, risks };
}

/** On board, the next train is watched too once its departure is this close (minutes). */
export const WATCH_NEXT_MIN = 20;

/**
 * Journeys worth asking OJP about now: the train you are on or about to board, and, on board,
 * the next one only when it leaves within WATCH_NEXT_MIN (when its delay or cancellation can
 * break the connection). Each is a request every poll, so no more than that.
 */
export function journeysToWatch(state: LiveState, now: number): string[] {
  if (state.phase === 'done') return [];
  const soon = (r?: LiveRide) => {
    const d = r?.stops[0]?.dep;
    // Not one that has left (a train missed): nothing to watch there.
    return d !== undefined && d > now && d - now <= WATCH_NEXT_MIN * 60_000;
  };
  // Waiting (a stay, or before the first train): the train to board only once it is close.
  if (state.phase !== 'riding' && !soon(state.rides[state.current])) return [];
  const rides = [state.rides[state.current]];
  const next = state.rides[state.current + 1];
  const dep = next?.stops[0]?.dep;
  if (state.phase === 'riding' && dep !== undefined && dep - now <= WATCH_NEXT_MIN * 60_000)
    rides.push(next);
  return rides.map((r) => r?.s.journey).filter((j): j is string => !!j);
}

/** The expected arrival at the end of the trip, with what live data says (undefined: none). */
export function expectedArrival(
  chain: Connection[],
  status: Map<string, JourneyStatus>,
): number | undefined {
  const last = liveRides(chain, status).at(-1);
  return last?.stops.at(-1)?.arr;
}
