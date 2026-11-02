import { describe, expect, it } from 'vitest';
import type { Connection, Waypoint } from '../src/core/model';
import { join, passesVias, stitched, subLegs } from '../src/core/planner/stitch';
import { conn, ref, ride } from './helpers/timetable';

const w = (name: string): Waypoint => ({ stopRef: ref(name), name, kind: 'via', dwellMin: 0 });

describe('subLegs', () => {
  it('pairs each via with the next one as destination', () => {
    const names = (x: ReturnType<typeof subLegs>) =>
      x.map((p) => `${p.from.name}>${p.via.map((v) => v.name).join()}>${p.to.name}`);
    expect(
      names(subLegs(w('Zürich HB'), ['Chur', 'Thusis', 'Filisur'].map(w), w('Preda'))),
    ).toEqual(['Zürich HB>Chur>Thusis', 'Thusis>Filisur>Preda']);
    expect(names(subLegs(w('Zürich HB'), ['Chur', 'Thusis'].map(w), w('Preda')))).toEqual([
      'Zürich HB>Chur>Thusis',
      'Thusis>>Preda',
    ]);
  });
});

describe('join', () => {
  const a = ride(
    'RE 1',
    [
      ['Chur', '09:00'],
      ['Thusis', '09:30'],
    ],
    { journey: 'j1' },
  );
  const b = ride(
    'RE 1',
    [
      ['Thusis', '09:32'],
      ['Filisur', '10:00'],
    ],
    { journey: 'j1' },
  );
  const c = ride(
    'R 2',
    [
      ['Thusis', '09:40'],
      ['Filisur', '10:10'],
    ],
    { journey: 'j2' },
  );

  it('merges the halves of one vehicle into one ride through the split stop', () => {
    const j = join(conn(a), conn(b));
    expect(j.sections).toHaveLength(1);
    expect(j.transfers).toBe(0);
    expect(j.sections[0]!.intermediate.map((x) => x.name)).toEqual(['Thusis']);
    expect(j.sections[0]!.intermediate[0]!.dep).toBe(b.from.dep);
  });

  it('keeps a real change as two rides', () => {
    const j = join(conn(a), conn(c));
    expect(j.sections).toHaveLength(2);
    expect(j.transfers).toBe(1);
  });
});

describe('stitched', () => {
  it('chains sub-queries with transfer time, none for the same vehicle', async () => {
    const legs: Record<string, Connection[]> = {
      'Chur>Thusis': [
        conn(
          ride(
            'RE 1',
            [
              ['Chur', '09:00'],
              ['Filisur', '09:20'],
              ['Thusis', '09:30'],
            ],
            { journey: 'j1' },
          ),
        ),
      ],
      'Thusis>Preda': [
        conn(
          ride(
            'RE 1',
            [
              ['Thusis', '09:31'],
              ['Bergün/Bravuogn', '09:50'],
              ['Preda', '10:00'],
            ],
            { journey: 'j1' },
          ),
        ),
        conn(
          ride(
            'R 9',
            [
              ['Thusis', '09:32'],
              ['Preda', '10:05'],
            ],
            { journey: 'j9' },
          ),
        ),
      ],
    };
    const asked: string[] = [];
    const query = async (from: Waypoint, to: Waypoint) => {
      asked.push(`${from.name}>${to.name}`);
      return legs[`${from.name}>${to.name}`] ?? [];
    };
    const out = await stitched(
      w('Chur'),
      [w('Filisur'), w('Thusis'), w('Bergün/Bravuogn')],
      w('Preda'),
      0,
      query,
      3,
    );
    expect(asked).toEqual(['Chur>Thusis', 'Thusis>Preda']);
    expect(out).toHaveLength(1);
    expect(out[0]!.transfers).toBe(0);
    expect(passesVias(out[0]!, ['Filisur', 'Thusis', 'Bergün/Bravuogn'].map(w))).toBe(true);
  });
});

describe('passesVias at a replacement stop', () => {
  it('takes the replacement bus stop outside the station as the station', () => {
    const c = conn(
      ride('EV 3', [
        ['Wilderswil', '09:00'],
        ['Interlaken Ost, Bahnhof', '09:10'],
      ]),
    );
    expect(passesVias(c, [w('Interlaken Ost')])).toBe(true);
    // Any other station is still missed.
    expect(passesVias(c, [w('Bern')])).toBe(false);
    // A city bus from the stop outside the station is no ride through the station.
    const bus = conn(
      ride('B 1', [
        ['Wilderswil', '09:00'],
        ['Interlaken Ost, Bahnhof', '09:10'],
      ]),
    );
    expect(passesVias(bus, [w('Interlaken Ost')])).toBe(false);
  });
});

describe('stitched diversity', () => {
  it('keeps different starts apart instead of funnelling them into one chain', async () => {
    const a = (d: string, a_: string, j: string) =>
      conn(
        ride(
          'IR 1',
          [
            ['Zürich HB', d],
            ['Chur', a_],
          ],
          { journey: j },
        ),
      );
    const b = (d: string, a_: string, j: string) =>
      conn(
        ride(
          'RE 2',
          [
            ['Chur', d],
            ['Preda', a_],
          ],
          { journey: j },
        ),
      );
    const legs: Record<string, Connection[]> = {
      'Zürich HB>Chur': [a('07:00', '08:15', 'a1'), a('08:00', '09:15', 'a2')],
      'Chur>Preda': [b('09:30', '10:30', 'b1'), b('10:30', '11:30', 'b2')],
    };
    const query = async (from: Waypoint, to: Waypoint) => legs[`${from.name}>${to.name}`] ?? [];
    const out = await stitched(
      w('Zürich HB'),
      [w('Thusis'), w('Chur'), w('Filisur')],
      w('Preda'),
      0,
      query,
      3,
    );
    expect(new Set(out.map((c) => c.dep)).size).toBe(2);
  });
});
