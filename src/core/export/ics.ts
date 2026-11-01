// iCalendar (RFC 5545) with one event per ride section.
import type { Connection } from '../model';

const stamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

const utf8 = new TextEncoder();

/** Folds lines at 75 octets as RFC 5545 requires, between whole characters (ü, →, emoji). */
export function fold(line: string): string {
  const parts: string[] = [];
  let part = '';
  let size = 0;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    // The first line holds 75 octets; continuations 74 after their leading space.
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(part);
      part = '';
      size = 0;
    }
    part += ch;
    size += n;
  }
  parts.push(part);
  return parts.join('\r\n ');
}

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
