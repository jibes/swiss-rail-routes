// Where you change trains: the arrival platform and the next train's (0.17.3).
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { changeAt, changePlatforms } from '../src/core/changePlatform';
import { platformAt } from '../src/core/live';
import type { Section } from '../src/core/model';
import { parseTrips } from '../src/core/ojp/parse';
import type { LineRow, StationRow } from '../src/core/rows';
import { ride } from './helpers/timetable';

const station = (name: string, role: StationRow['role']): StationRow => ({
  type: 'station',
  name,
  key: name,
  role,
});
const rideRow = (s: Section, sectionIndex = 0): LineRow => ({
  type: 'ride',
  section: s,
  leg: 0,
  sectionIndex,
});
const ir = (j: string, a: string, b: string, from?: string, to?: string): Section => {
  const s = ride('IR 1', [
    [a, '08:00'],
    [b, '08:30'],
  ]);
  return {
    ...s,
    journey: j,
    from: { ...s.from, platform: from },
    to: { ...s.to, platform: to },
  };
};
const walk = (): Section => ({
  ...ir('w', 'Zug', 'Arth-Goldau'),
  mode: 'walk',
  journey: undefined,
});

describe('which station is a change', () => {
  const a = ir('j1', 'Zürich HB', 'Zug', '3', '7');
  const b = ir('j2', 'Zug', 'Arth-Goldau', '8', '2');
  const rows: LineRow[] = [
    station('Zürich HB', 'start'),
    rideRow(a),
    station('Zug', 'change'),
    rideRow(b, 1),
    station('Arth-Goldau', 'end'),
  ];

  it('a change between two trains, never the start or the end', () => {
    expect(changeAt(rows, 0)).toBeUndefined();
    expect(changeAt(rows, 2)).toEqual({ arr: rows[1], dep: rows[3] });
    expect(changeAt(rows, 4)).toBeUndefined();
  });

  it('the same train going on is no change; a walk on is one with no departure here', () => {
    const through = [
      rows[0]!,
      rideRow(a),
      station('Zug', 'stop'),
      rideRow({ ...b, journey: 'j1' }),
    ];
    expect(changeAt(through, 2)).toBeUndefined();
    const onFoot = [rows[0]!, rideRow(a), station('Zug', 'change'), rideRow(walk())];
    expect(changeAt(onFoot, 2)).toEqual({ arr: onFoot[1] });
    // Arriving on foot: the platform you arrive on is no train's.
    const fromWalk = [rows[0]!, rideRow(walk()), station('Zug', 'change'), rideRow(b)];
    expect(changeAt(fromWalk, 2)).toBeUndefined();
  });
});

describe('what the row says', () => {
  it('both platforms, the same one, or the arrival alone when you walk on', () => {
    expect(changePlatforms('7', '8')).toEqual({ kind: 'both', arr: '7', dep: '8' });
    expect(changePlatforms('7', '7')).toEqual({ kind: 'same', p: '7' });
    expect(changePlatforms('7', undefined, true)).toEqual({ kind: 'arr', arr: '7' });
  });

  it('nothing when a platform it needs is not known', () => {
    expect(changePlatforms(undefined, '8')).toBeUndefined();
    expect(changePlatforms('7', undefined)).toBeUndefined();
    expect(changePlatforms(undefined, undefined, true)).toBeUndefined();
  });

  it('under way, the arrival platform the train reports wins and shows as moved', () => {
    const to = { ...ir('j1', 'Zürich HB', 'Zug').to, platform: '7' };
    expect(platformAt(to, { platform: '9' })).toEqual({
      now: '9',
      moved: { now: '9', was: '7' },
    });
    expect(platformAt(to, { platform: '7' }).moved).toBeUndefined();
    // Known as the plan was made: shown as moved before the train reports.
    expect(platformAt({ ...to, platformEst: '6' }).moved).toEqual({ now: '6', was: '7' });
  });
});

describe('recorded answers carry arrival platforms', () => {
  it('every ride of T3 arrives with a platform from the timetable', () => {
    const dir = 'tests/fixtures/ojp/T3';
    const file = readdirSync(dir).find((f) => f.endsWith('.xml.gz'))!;
    const trips = parseTrips(gunzipSync(readFileSync(`${dir}/${file}`)).toString('utf8'));
    const rides = trips.flatMap((c) => c.sections).filter((s) => s.mode !== 'walk');
    expect(rides.length).toBeGreaterThan(0);
    expect(rides.filter((s) => s.to.platform).length).toBe(rides.length);
  });
});
