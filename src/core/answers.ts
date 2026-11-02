// Timetable answers kept on the device (0.8.4), so looking at other connections, editing back
// and forth or opening the app again asks the timetable service only for what is new. Pure: when
// an answer is still good, and which go when there are too many.
import type { Connection, Tour } from './model';
import type { TripQuery } from './ojp/request';
import { dayOf } from './trip';

export interface KeptAnswer {
  /** The day asked about (`YYYY-MM-DD`, Zurich). */
  day: string;
  /** When it came (ms). */
  at: number;
  /** Characters it takes, about bytes. */
  size: number;
  connections: Connection[];
}

/**
 * On the day itself trains run late or are cancelled: an answer is good for this long. Before
 * the day the timetable holds, so an answer is good until the day starts.
 */
export const SAME_DAY_MS = 15 * 60_000;
/** All answers together stay under this (about 8 MB); the oldest go first. */
export const ANSWERS_MAX = 8_000_000;

/** One key per question: the same query asked again is the same answer. */
export const answerKey = (q: TripQuery) => JSON.stringify(q);

/** The day a query asks about. */
export const dayOfQuery = (q: TripQuery) => q.time.slice(0, 10);

type Meta = Pick<KeptAnswer, 'day' | 'at' | 'size'>;

/** Whether a kept answer can stand for asking again now. */
export function stillGood(a: Meta, now: number): boolean {
  const { day } = a;
  if (typeof day !== 'string' || !(a.at <= now)) return false;
  const today = dayOf(now);
  if (day < today) return false;
  // Asked before the day: good until it starts. Asked on the day: 15 minutes.
  if (day > today) return true;
  return dayOf(a.at) === today && now - a.at < SAME_DAY_MS;
}

/** The keys to drop: answers no longer good, then the oldest beyond `max` characters. */
export function toDrop(all: [string, Meta][], now: number, max = ANSWERS_MAX): string[] {
  const drop: string[] = [];
  const keep: [string, Meta][] = [];
  for (const [k, a] of all) {
    if (stillGood(a, now)) keep.push([k, a]);
    else drop.push(k);
  }
  let total = 0;
  for (const [k, a] of keep.sort((x, y) => y[1].at - x[1].at)) {
    total += a.size;
    if (total > max) drop.push(k);
  }
  return drop;
}

/**
 * A route as its options depend on it: its stations, day and ticket, not its name or the time
 * it was asked from. Options found for one time stay options when another is chosen.
 */
export const optionsKey = (t: Pick<Tour, 'waypoints' | 'date' | 'ticket' | 'travelClass'>) =>
  JSON.stringify({ w: t.waypoints, d: t.date, t: t.ticket, c: t.travelClass });
