// iCalendar (RFC 5545) with one event per ride section.
import type { Connection } from '../model';

const stamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

/** Folds lines at 75 octets as the RFC requires (approximated by UTF-16 units; fine for our text). */
const fold = (line: string) => line.match(/.{1,74}/g)!.join('\r\n ');

export function toIcs(tourName: string, chain: Connection[], uidBase: string, now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//swiss-rail-routes//EN',
    'CALSCALE:GREGORIAN',
  ];
  chain.forEach((c, ci) =>
    c.sections.forEach((s, si) => {
      if (s.mode === 'walk' || !s.from.dep || !s.to.arr) return;
      const what = [s.category, s.number ?? s.line].filter(Boolean).join(' ');
      const platform = s.from.platform ? ` (${s.from.platform})` : '';
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uidBase}-${ci}-${si}@swiss-rail-routes`,
        `DTSTAMP:${stamp(now.toISOString())}`,
        `DTSTART:${stamp(s.from.dep)}`,
        `DTEND:${stamp(s.to.arr)}`,
        `SUMMARY:${escape(`${what} ${s.from.name} → ${s.to.name}`.trim())}`,
        `LOCATION:${escape(s.from.name + platform)}`,
        `DESCRIPTION:${escape(tourName)}`,
        'END:VEVENT',
      );
    }),
  );
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
