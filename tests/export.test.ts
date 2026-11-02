import { describe, expect, it } from 'vitest';
import { newTour, addWaypoint, setRoundTrip } from '../src/core/edit';
import { toIcs } from '../src/core/export/ics';
import { decodeTour, encodeTour } from '../src/core/export/share';
import type { Connection } from '../src/core/model';

const chain: Connection[] = [
  {
    legIndex: 0,
    dep: '2026-11-07T08:09:00+01:00',
    arr: '2026-11-07T10:30:00+01:00',
    transfers: 1,
    sections: [
      {
        mode: 'rail',
        category: 'IR',
        number: '38',
        from: { stopRef: 'a', name: 'Zürich HB', dep: '2026-11-07T08:09:00+01:00', platform: '14' },
        to: { stopRef: 'b', name: 'Chur', arr: '2026-11-07T09:23:00+01:00' },
        intermediate: [],
        geometry: [
          [8.54, 47.378],
          [9.53, 46.853],
        ],
      },
      {
        mode: 'walk',
        from: { stopRef: 'b', name: 'Chur' },
        to: { stopRef: 'b', name: 'Chur' },
        intermediate: [],
      },
    ],
  },
];

describe('share link', () => {
  it('round-trips a tour with umlauts and gets a new id', () => {
    const t = setRoundTrip(
      addWaypoint(newTour('mine', '2026-11-07', { stopRef: 'x', name: 'Zürich HB' }), {
        stopRef: 'y',
        name: 'Mürren BLM',
      }),
      true,
    );
    const hash = encodeTour({ ...t, name: 'Bündner Rundfahrt' });
    expect(hash).toMatch(/^#\/t\/[A-Za-z0-9_-]+$/);
    const back = decodeTour(hash, 'new');
    expect(back).toEqual({ ...t, name: 'Bündner Rundfahrt', id: 'new' });
  });

  it('rejects foreign or broken hashes', () => {
    expect(decodeTour('#/x/abc', 'n')).toBeNull();
    expect(decodeTour('#/t/!!!', 'n')).toBeNull();
    expect(decodeTour('#/t/' + btoa('{"schema":2}'), 'n')).toBeNull();
  });
});

describe('ics', () => {
  const ics = toIcs('Graubünden; loop', chain, 'tour1', new Date('2026-11-01T12:00:00Z'));
  it('has one event per ride, UTC times, escaped text, CRLF', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART:20261107T070900Z');
    expect(ics).toContain('DTEND:20261107T082300Z');
    expect(ics).toContain('SUMMARY:IR 38 Zürich HB → Chur');
    expect(ics).toContain('LOCATION:Zürich HB (14)');
    expect(ics).toContain('DESCRIPTION:Graubünden\\; loop');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});

describe('ICS line folding', () => {
  it('folds at 75 octets between whole characters (ü, →, emoji)', async () => {
    const { fold } = await import('../src/core/export/ics');
    const line = `SUMMARY:${'Zürich → Göschenen 🚆 '.repeat(8)}`;
    const parts = fold(line).split('\r\n ');
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    expect(bytes(parts[0]!)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(bytes(p)).toBeLessThanOrEqual(74);
    expect(parts.join('')).toBe(line); // nothing split inside a character
  });
});
