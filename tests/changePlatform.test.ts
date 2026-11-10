// Where you change trains: the arrival platform and the next train's (0.17.3).
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { stationPlatforms } from '../src/core/changePlatform';
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

describe('the platforms beside a station (0.50.0)', () => {
  const a = ir('j1', 'Zürich HB', 'Zug', '3', '7');
  const b = ir('j2', 'Zug', 'Arth-Goldau', '8', '2');
  const rows: LineRow[] = [
    station('Zürich HB', 'start'),
    rideRow(a),
    station('Zug', 'change'),
    rideRow(b, 1),
    station('Arth-Goldau', 'end'),
  ];

  it('the start where you board, a change both, the end where you get off', () => {
    expect(stationPlatforms(rows, 0)).toEqual({ dep: rows[1] });
    expect(stationPlatforms(rows, 2)).toEqual({ arr: rows[1], dep: rows[3] });
    expect(stationPlatforms(rows, 4)).toEqual({ arr: rows[3] });
    expect(stationPlatforms(rows, 1)).toEqual({});
  });

  it('none where the same train runs on; on foot, only the train’s side', () => {
    const through = [
      rows[0]!,
      rideRow(a),
      station('Zug', 'stop'),
      rideRow({ ...b, journey: 'j1' }),
    ];
    expect(stationPlatforms(through, 2)).toEqual({});
    const onFoot = [rows[0]!, rideRow(a), station('Zug', 'change'), rideRow(walk())];
    expect(stationPlatforms(onFoot, 2)).toEqual({ arr: onFoot[1] });
    const fromWalk = [rows[0]!, rideRow(walk()), station('Zug', 'change'), rideRow(b)];
    expect(stationPlatforms(fromWalk, 2)).toEqual({ dep: fromWalk[3] });
  });

  it('rows drawn inside a ride are passed over', () => {
    const inside = [
      rows[0]!,
      rideRow(a),
      station('Baar', 'pass'),
      station('Zug', 'change'),
      rideRow(b),
    ];
    expect(stationPlatforms(inside, 3, new Set([2]))).toEqual({ arr: inside[1], dep: inside[4] });
  });
});

describe('platforms under way', () => {
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
