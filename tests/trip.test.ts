import { describe, expect, it } from 'vitest';
import { newTour } from './helpers/edit';
import type { PlannedChain } from '../src/core/planner/plan';
import {
  changesOf,
  compactTrip,
  zurichTime,
  liveTrip,
  newTrip,
  revise,
  sortTrips,
  tripStatus,
  undo,
  withoutTimetable,
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

describe('without its timetable', () => {
  it('keeps the route and is planned again', () => {
    const t = trip('a', '08:00', '18:00');
    const x = withoutTimetable(t);
    expect(x.route).toEqual(t.route);
    expect(x.chain).toBeUndefined();
    expect(x.legs).toBeUndefined();
    expect(tripStatus(x, at('09:00'))).toBe('upcoming');
  });
});

describe('trip status', () => {
  const t = trip('a', '08:00', '18:00');
  it('is live from 30 min before departure to 15 min after arrival', () => {
    expect(tripStatus(t, at('07:29'))).toBe('upcoming');
    expect(tripStatus(t, at('07:30'))).toBe('live');
    expect(tripStatus(t, at('18:15'))).toBe('live');
    expect(tripStatus(t, at('18:16'))).toBe('past');
  });

  it('put in after its time (0.49.0): as before it leaves, for the day it was changed', () => {
    // Changed at 19:00, after it ran 08:00–18:00: being put in, not one that ran.
    const late = { ...t, editedAt: '2026-11-07T19:00:00Z' };
    expect(tripStatus(late, at('19:30'))).toBe('upcoming');
    // The day after, it ran.
    expect(tripStatus(late, Date.parse('2026-11-08T08:00:00Z'))).toBe('past');
    // Changed before it left: it ran, over once over.
    expect(tripStatus({ ...t, editedAt: '2026-11-07T07:00:00Z' }, at('19:30'))).toBe('past');
    // Put in while it runs: under way as any other.
    expect(tripStatus({ ...t, editedAt: '2026-11-07T09:00:00Z' }, at('10:00'))).toBe('live');
    // Not planned yet, dated a day gone, changed today: being put in.
    const unplanned = withoutTimetable({ ...t, route: { ...t.route, date: '2026-11-05' } });
    expect(tripStatus(unplanned, at('10:00'))).toBe('past');
    expect(tripStatus({ ...unplanned, editedAt: '2026-11-07T09:00:00Z' }, at('10:00'))).toBe(
      'upcoming',
    );
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

describe('changes', () => {
  const ride = (): { mode: 'rail' } => ({ mode: 'rail' });
  const walk = (): { mode: 'walk' } => ({ mode: 'walk' });
  it('counts every ride after the first of a connection; walks and the stops between legs are none', () => {
    const c = (...sections: { mode: 'rail' | 'walk' }[]) => ({ sections: sections as never });
    expect(changesOf([c(ride(), walk(), ride()), c(ride()), c(ride(), ride(), ride())])).toBe(3);
    expect(changesOf([c(walk(), ride(), walk())])).toBe(0);
    expect(changesOf([])).toBe(0);
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
});
