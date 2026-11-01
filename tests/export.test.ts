import { describe, expect, it } from 'vitest';
import { newTour, addWaypoint, setRoundTrip } from '../src/core/edit';
import { toGpx } from '../src/core/export/gpx';
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

describe('gpx', () => {
  it('writes one segment per section with geometry', () => {
    const gpx = toGpx('A & B', chain);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    expect(gpx).toContain('<trkpt lat="47.378000" lon="8.540000"/>');
    expect(gpx).toContain('<name>A &amp; B</name>');
  });
});
