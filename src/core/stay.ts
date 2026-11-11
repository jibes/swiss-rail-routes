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
 * (`was`, chosen by its date) keeps that day.
 */
export function untilAt(
  hm: string,
  arr: string | undefined,
  day: string,
  was: string | undefined,
): string {
  const arrived = arr ? zurichLocal(Date.parse(arr)) : undefined;
  const base = arrived?.slice(0, 10) ?? day;
  const wasDay = was?.slice(0, 10);
  const at = `${wasDay && wasDay > base ? wasDay : base}T${hm}`;
  return arrived && at < arrived ? `${nextDay(base)}T${hm}` : at;
}

/** A stay's time moved by `min` minutes. */
export function shiftUntil(until: string, min: number): string {
  return zurichLocal(Date.parse(zurichDateTime(until)) + min * MIN);
}
