// When a trip leaves: what the date and time fields accept (SPEC §3a).

/** The time a field's value stands for: today not before now (a connection gone is no option);
 * null when it is no time. */
export function acceptTime(hm: string, date: string, today: string, nowHm: string): string | null {
  if (!/^\d\d:\d\d$/.test(hm)) return null;
  return date === today && hm < nowHm ? nowHm : hm;
}

/** The day a field's value stands for; null when it is no day or has gone (`min` only limits the
 * picker: a day typed passes it). */
export function acceptDate(date: string, today: string): string | null {
  return /^\d{4}-\d\d-\d\d$/.test(date) && date >= today ? date : null;
}

/** The time a trip moved to `date` leaves from: today, from `soon` when its time has gone. */
export function timeOnDate(date: string, today: string, soon: string, hm: string): string {
  return date === today && soon > hm ? soon : hm;
}
