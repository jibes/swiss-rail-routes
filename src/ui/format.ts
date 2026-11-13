import type { Section } from '../core/model';
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

/** A moment's day and month in Zurich ("13 Nov"), as a notice's validity says it. */
export function dayMonth(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Zurich',
  }).format(new Date(iso));
}

const ZURICH_HM = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** A time as `HH:MM` in Zurich. */
export const zurichHm = (ms: number) => ZURICH_HM.format(ms);

/** The next five minutes in Zurich, `HH:MM` (a new trip leaves from then; 23:55 at most). */
export function nextFive(now: number): string {
  const [h, m] = ZURICH_HM.format(now).split(':').map(Number) as [number, number];
  const t = Math.min(23 * 60 + 55, Math.ceil((h * 60 + m + 1) / 5) * 5);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** `HH:MM` moved by `min` minutes, within the day (Earlier/Later, Try an hour later). */
export function shiftHm(hm: string, min: number): string {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + min));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** "R62", "IC3"; numeric lines with their category: "CC 63" (cog), "PB 2461" (cable car). */
export const badge = (s: Section) =>
  s.line && /[A-Za-z]/.test(s.line)
    ? s.line
    : [s.category, s.line ?? s.number].filter(Boolean).join(' ');
