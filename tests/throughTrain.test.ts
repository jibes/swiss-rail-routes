// Retest round 3, 6 Nov 2026: a train running on under another number (S29 on as the S1) was a
// change with a "0 min" tight-transfer warning. OJP marks no such thing (no stay-seated element in
// any recorded answer): two rail rides meeting at the same stop within a minute, from the same
// platform, are the same train. Neither a change, nor tight, nor a platform line, nor notices.
import { describe, expect, it } from 'vitest';
import { changeAt, continuesAs } from '../src/core/changePlatform';
import type { Connection, Section } from '../src/core/model';
import { runsOn, transferGaps } from '../src/core/planner/connection';
import type { LineRow } from '../src/core/rows';
import { changesOf } from '../src/core/trip';
import { ride } from './helpers/timetable';

const leg = (
  line: string,
  j: string,
  a: [string, string, string?],
  b: [string, string, string?],
) => {
  const s = ride(line, [
    [a[0], a[1]],
    [b[0], b[1]],
  ]);
  return {
    ...s,
    line,
    journey: j,
    from: { ...s.from, platform: a[2] },
    to: { ...s.to, platform: b[2] },
  } as Section;
};
const s29 = leg('S29', 'j1', ['Olten', '09:36', '11'], ['Sursee', '10:08', '2']);
const s1 = (dep: string, pl?: string) =>
  leg('S1', 'j2', ['Sursee', dep, pl], ['Luzern', '10:35', '4']);
const conn = (...sections: Section[]): Connection =>
  ({
    legIndex: 0,
    dep: sections[0]!.from.dep!,
    arr: sections.at(-1)!.to.arr!,
    transfers: 1,
    sections,
  }) as Connection;

describe('the same train running on under another number', () => {
  it('two rail rides at one stop, within a minute, from one platform: one train', () => {
    expect(runsOn(s29, s1('10:08', '2'))).toBe(true);
    expect(runsOn(s29, s1('10:09', '2'))).toBe(true);
    // The same track, other sectors (as OJP writes Sursee's track 2: 2AB, 2CD).
    expect(runsOn({ ...s29, to: { ...s29.to, platform: '2AB' } }, s1('10:08', '2CD'))).toBe(true);
  });

  it('a minute more, another platform, or no platform known: a change', () => {
    expect(runsOn(s29, s1('10:10', '2'))).toBe(false);
    expect(runsOn(s29, s1('10:08', '3'))).toBe(false);
    expect(runsOn(s29, s1('10:08'))).toBe(false);
  });

  it('no change counted, no tight transfer, no platform line; the station says it runs on', () => {
    const c = conn(s29, s1('10:08', '2'));
    expect(changesOf([c])).toBe(0);
    expect(transferGaps(c)).toEqual([]);
    const rows: LineRow[] = [
      { type: 'station', name: 'Olten', key: 'Olten', role: 'start' },
      { type: 'ride', section: c.sections[0]!, leg: 0, sectionIndex: 0 },
      { type: 'station', name: 'Sursee', key: 'Sursee', role: 'change' },
      { type: 'ride', section: c.sections[1]!, leg: 0, sectionIndex: 1 },
      { type: 'station', name: 'Luzern', key: 'Luzern', role: 'end' },
    ];
    expect(changeAt(rows, 2)).toBeUndefined();
    expect(continuesAs(rows, 2)).toBe('S1');
    // A real change stays one.
    const change = conn(s29, s1('10:18', '2'));
    expect(changesOf([change])).toBe(1);
    expect(transferGaps(change)).toHaveLength(1);
  });
});
