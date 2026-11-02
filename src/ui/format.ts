const tz = 'Europe/Zurich';

export const hhmm = (iso: string | number) =>
  new Intl.DateTimeFormat('de-CH', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(
    typeof iso === 'number' ? iso : Date.parse(iso),
  );

export const minutesBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

export const duration = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

export function longDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "Sa., 7. Nov." / "Sat, 7 Nov". */
export function shortDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

const ZURICH_HM = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** A time as `HH:MM` in Zurich. */
export const zurichHm = (ms: number) => ZURICH_HM.format(ms);

/** The next full or half hour in Zurich, `HH:MM` (the day's last, 23:30, at most). */
export function nextHalfHour(now: number): string {
  const [h, m] = ZURICH_HM.format(now).split(':').map(Number) as [number, number];
  const t = Math.min(23 * 60 + 30, Math.ceil((h * 60 + m + 1) / 30) * 30);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
