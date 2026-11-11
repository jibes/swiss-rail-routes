// A stay said as one row (0.51.0): how long and until when, each filled from the other by the
// plan's arrival. The one edited last is what is kept: a length (relative, `dwellMin`) or a time
// (absolute, `stayUntil`). Times here are local Zurich `YYYY-MM-DDTHH:MM`; arrivals ISO.
import { zurichDateTime } from './ojp/request';
import { zurichLocal } from './planner/plan';

const MIN = 60_000;

/** Until when a stay lasts: its time, else the arrival and its length; unknown before a plan. */
export function stayEnd(
  arr: string | undefined,
  stay: number,
  until: string | undefined,
): string | undefined {
  if (until) return until;
  return arr ? zurichLocal(Date.parse(arr) + stay * MIN) : undefined;
}

/** How long a stay lasts: its length, else from the arrival to its time (unknown before). */
export function stayLength(
  arr: string | undefined,
  stay: number,
  until: string | undefined,
): number | undefined {
  if (!until) return stay;
  if (!arr) return undefined;
  return Math.max(0, Math.round((Date.parse(zurichDateTime(until)) - Date.parse(arr)) / MIN));
}

const nextDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/**
 * A time typed for the stay's end, made a date and time: on the arrival's day (else the trip's),
 * a time before the arrival the day after (across midnight); a stay kept until a later day
 * than that (`was`, chosen by its date) keeps its day.
 */
export function untilAt(
  hm: string,
  arr: string | undefined,
  day: string,
  was: string | undefined,
): string {
  const arrived = arr ? zurichLocal(Date.parse(arr)) : undefined;
  const base = arrived?.slice(0, 10) ?? day;
  // The day after is the wrap past midnight, not a day chosen: only a later one is kept
  // (reported in review: 01:00 then 23:00 made a 25 h stay).
  const wasDay = was?.slice(0, 10);
  // A day chosen (on the date pill) is kept; the next day reached only by wrapping past midnight
  // is not. A wrap gives a time before the arrival's, so a later one on the next day was chosen
  // (review of 11 Nov 2026: Tue 21:00 chosen, retyped 21:30, became Mon).
  const chosen =
    !!wasDay &&
    wasDay > base &&
    (wasDay > nextDay(base) || !arrived || was!.slice(11, 16) >= arrived.slice(11, 16));
  const at = `${chosen ? wasDay : base}T${hm}`;
  return arrived && at < arrived ? `${nextDay(base)}T${hm}` : at;
}

/** A stay's time moved by `min` minutes. */
export function shiftUntil(until: string, min: number): string {
  return zurichLocal(Date.parse(zurichDateTime(until)) + min * MIN);
}

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);

/** Days from `from` to `to` (both `YYYY-MM-DD`). */
export const daysBetween = (from: string, to: string) =>
  Math.round((dayMs(to) - dayMs(from)) / 86_400_000);

/** A stay's time moved by whole days (its clock time kept). */
export function untilByDays(until: string, days: number): string {
  if (!days) return until;
  const t = new Date(`${until.slice(0, 10)}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.toISOString().slice(0, 10)}${until.slice(10)}`;
}

/**
 * Stations moved from one day to another (a trip's date changed, a past trip's stations reused):
 * a stay until a date and time moves with them, so it lasts as long as it did.
 */
export function staysOnDay<W extends { stayUntil?: string }>(
  waypoints: W[],
  from: string,
  to: string,
): W[] {
  const days = daysBetween(from, to);
  if (!days) return waypoints;
  return waypoints.map((w) =>
    w.stayUntil ? { ...w, stayUntil: untilByDays(w.stayUntil, days) } : w,
  );
}
