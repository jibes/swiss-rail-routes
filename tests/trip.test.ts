import { describe, expect, it } from 'vitest';
import { newTour } from './helpers/edit';
import type { PlannedChain } from '../src/core/planner/plan';
import {
  compactTrip,
  defaultDate,
  zurichTime,
  liveTrip,
  newTrip,
  revise,
  sortTrips,
  tripStatus,
  undo,
  type Trip,
} from '../src/core/trip';

const chain = (dep: string, arr: string): PlannedChain => ({
  connections: [],
  warnings: [],
  score: 0,
  dep: `2026-11-07T${dep}:00Z`,
  arr: `2026-11-07T${arr}:00Z`,
});
const at = (hhmm: string) => Date.parse(`2026-11-07T${hhmm}:00Z`);
const trip = (id: string, dep: string, arr: string) =>
  newTrip(id, { ...newTour('r', '2026-11-07'), name: id }, [], chain(dep, arr), new Date(0));

describe('trip status', () => {
  const t = trip('a', '08:00', '18:00');
  it('is live from 30 min before departure to 15 min after arrival', () => {
    expect(tripStatus(t, at('07:29'))).toBe('upcoming');
    expect(tripStatus(t, at('07:30'))).toBe('live');
    expect(tripStatus(t, at('18:15'))).toBe('live');
    expect(tripStatus(t, at('18:16'))).toBe('past');
  });

  it('sorts current soonest first, past latest first, and finds the live one', () => {
    const list = [
      trip('late', '15:00', '16:00'),
      trip('now', '09:00', '12:00'),
      trip('done', '06:00', '07:00'),
    ];
    const s = sortTrips(list, at('10:00'));
    expect(s.current.map((x) => x.name)).toEqual(['now', 'late']);
    expect(s.past.map((x) => x.name)).toEqual(['done']);
    expect(liveTrip(list, at('10:00'))?.name).toBe('now');
    expect(liveTrip(list, at('13:00'))).toBeUndefined();
  });
});

describe('versions', () => {
  it('freezes the route, revises with undo of one step', () => {
    const route = { ...newTour('r', '2026-11-07'), name: 'X' };
    const t = newTrip('t', route, [], chain('08:00', '18:00'), new Date(0));
    route.name = 'changed later';
    expect(t.route.name).toBe('X');
    const r = revise(
      t,
      { route: t.route, legs: [], chain: chain('08:00', '19:00') },
      new Date(1000),
    );
    expect(r.version).toBe(2);
    expect(r.chain.arr).toContain('19:00');
    expect(r.previous?.chain?.arr).toContain('18:00');
    const u = undo(r);
    expect(u.chain.arr).toContain('18:00');
    expect(u.previous).toBeUndefined();
    expect(undo(u)).toBe(u);
  });
});

describe('compact trips', () => {
  it('simplifies tracks once; a compact trip stays the same object (its hash does not move)', () => {
    const track: [number, number][] = Array.from({ length: 50 }, (_, i) => [
      8 + i * 0.001,
      47 + 0.00001 * (i % 2),
    ]);
    const loose = {
      ...newTrip(
        't',
        newTour('r', '2026-11-14'),
        [],
        { connections: [], warnings: [], score: 0, dep: '', arr: '' },
        new Date(0),
      ),
    };
    const withTrack = compactTrip({
      ...loose,
      compact: undefined,
      chain: {
        ...loose.chain,
        connections: [
          {
            legIndex: 0,
            dep: '',
            arr: '',
            transfers: 0,
            sections: [
              {
                mode: 'rail',
                from: { stopRef: 'a', name: 'A' },
                to: { stopRef: 'b', name: 'B' },
                intermediate: [],
                geometry: track,
              },
            ],
          },
        ],
      },
    } as Trip);
    expect(withTrack.compact).toBe(true);
    expect(withTrack.chain!.connections[0]!.sections[0]!.geometry!.length).toBe(2);
    expect(compactTrip(withTrack)).toBe(withTrack);
  });
});

describe('Zurich time', () => {
  it('is right on the two clock-change days', () => {
    expect(new Date(zurichTime('2026-03-29', '01:30')).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    expect(new Date(zurichTime('2026-10-25', '01:30')).toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    );
    expect(new Date(zurichTime('2026-07-01', '08:00')).toISOString()).toBe(
      '2026-07-01T06:00:00.000Z',
    );
  });

  it('the default day is the next Saturday in Zurich, whatever the device’s zone', () => {
    // Friday 23:30 in Zurich (22:30 UTC): Saturday is tomorrow.
    expect(defaultDate(Date.parse('2026-11-06T22:30:00Z'))).toBe('2026-11-07');
    // Saturday 00:30 in Zurich (Friday 23:30 UTC): today.
    expect(defaultDate(Date.parse('2026-11-06T23:30:00Z'))).toBe('2026-11-07');
    expect(defaultDate(Date.parse('2026-11-08T10:00:00Z'))).toBe('2026-11-14');
  });
});
