// When a trip leaves: what the date and time fields accept (SPEC §3a).

/**
 * How far back a day can be (0.49.0): a trip already under way, or one taken, is entered after
 * its time. OJP answers about two weeks back (10 Nov 2026: back to 26 Oct, nothing before).
 */
export const PAST_DAYS = 14;

/** The first day the date field offers: `PAST_DAYS` before today. */
export function earliestDay(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - PAST_DAYS);
  return d.toISOString().slice(0, 10);
}

/** The time a field's value stands for, any time of day (0.49.0: one gone today is a trip
 * already under way); null when it is no time. */
export function acceptTime(hm: string): string | null {
  return /^\d\d:\d\d$/.test(hm) ? hm : null;
}

/** The day a field's value stands for; null when it is no day or further back than the
 * timetable answers (`min` only limits the picker: a day typed passes it). */
export function acceptDate(date: string, today: string): string | null {
  return /^\d{4}-\d\d-\d\d$/.test(date) && date >= earliestDay(today) ? date : null;
}

/** The time a trip moved to `date` leaves from: today, from `soon` when its time has gone (a
 * trip moved to today goes now; a time gone is set on the time field itself). */
export function timeOnDate(date: string, today: string, soon: string, hm: string): string {
  return date === today && soon > hm ? soon : hm;
}
