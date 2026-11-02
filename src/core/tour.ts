import { normalise } from './edit';
import type { Leg, Tour, Waypoint } from './model';

/** Waypoints where the traveller gets off; every leg ends at one of these. */
const isBreak = (w: Waypoint) => w.kind !== 'via';

export function isRoundTrip(tour: Tour): boolean {
  const first = tour.waypoints[0];
  const last = tour.waypoints.at(-1);
  return tour.waypoints.length > 1 && !!first && !!last && first.stopRef === last.stopRef;
}

/** Splits a tour into legs at every non-via waypoint (SPEC §5 step 1). */
export function expandLegs(tour: Tour): Leg[] {
  const legs: Leg[] = [];
  let from: Waypoint | undefined;
  let vias: Waypoint[] = [];
  for (const w of tour.waypoints) {
    if (!from) {
      from = w;
      continue;
    }
    if (!isBreak(w)) {
      vias.push(w);
      continue;
    }
    legs.push({ index: legs.length, from, to: w, vias });
    from = w;
    vias = [];
  }
  return legs;
}

const TICKETS: Tour['ticket'][] = ['GA', 'Tageskarte', 'Halbtax', 'none'];
const KINDS: Waypoint['kind'][] = ['start', 'via', 'stop', 'turnaround', 'end'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A route from data the app did not make itself (an old `#/t/` link, storage written by an
 * older or damaged version), rebuilt from checked fields only: anything unknown is left out,
 * anything missing gets the builder's default. Null when the stations are unusable or fewer
 * than `minStops`.
 */
export function sanitiseTour(
  x: unknown,
  fallbackDate: string,
  minStops = 2,
): Omit<Tour, 'id'> | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.waypoints)) return null;
  const waypoints: Waypoint[] = [];
  for (const raw of o.waypoints) {
    const w = (raw ?? {}) as Record<string, unknown>;
    if (typeof w.stopRef !== 'string' || !w.stopRef || typeof w.name !== 'string') return null;
    const dwell = typeof w.dwellMin === 'number' && Number.isFinite(w.dwellMin) ? w.dwellMin : 0;
    waypoints.push({
      stopRef: w.stopRef,
      name: w.name,
      kind: KINDS.includes(w.kind as Waypoint['kind']) ? (w.kind as Waypoint['kind']) : 'via',
      dwellMin: Math.max(0, Math.min(24 * 60, Math.round(dwell))),
      ...(typeof w.templateId === 'string' ? { templateId: w.templateId } : {}),
      ...(w.ring === true && typeof w.templateId === 'string' ? { ring: true } : {}),
      ...(typeof w.earliestArr === 'string' && TIME.test(w.earliestArr)
        ? { earliestArr: w.earliestArr }
        : {}),
      ...(typeof w.latestDep === 'string' && TIME.test(w.latestDep)
        ? { latestDep: w.latestDep }
        : {}),
    });
  }
  if (waypoints.length < minStops) return null;
  const a = (o.anchor ?? {}) as Record<string, unknown>;
  const anchor: Tour['anchor'] =
    typeof a.arriveBy === 'string' && TIME.test(a.arriveBy)
      ? { arriveBy: a.arriveBy }
      : {
          departAt: typeof a.departAt === 'string' && TIME.test(a.departAt) ? a.departAt : '08:00',
        };
  return {
    name: typeof o.name === 'string' ? o.name.slice(0, 200) : '',
    date: typeof o.date === 'string' && DATE.test(o.date) ? o.date : fallbackDate,
    anchor,
    ticket: TICKETS.includes(o.ticket as Tour['ticket']) ? (o.ticket as Tour['ticket']) : 'GA',
    travelClass: o.travelClass === 1 ? 1 : 2,
    waypoints: normalise(waypoints),
    ...(typeof o.notes === 'string' ? { notes: o.notes } : {}),
    schema: 1,
  };
}
