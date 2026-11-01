import { describe, expect, it } from 'vitest';
import {
  addWaypoint,
  moveWaypoint,
  newTour,
  removeWaypoint,
  setDwell,
  setRoundTrip,
  setStop,
} from '../src/core/edit';
import { isRoundTrip } from '../src/core/tour';

const s = (name: string) => ({ stopRef: `ch:1:sloid:${name}`, name });
const kinds = (t: ReturnType<typeof newTour>) => t.waypoints.map((w) => `${w.name}:${w.kind}`);

describe('tour edits', () => {
  const base = addWaypoint(
    addWaypoint(newTour('t', '2026-11-07', s('Zurich')), s('Luzern')),
    s('Bern'),
  );

  it('keeps start and end kinds when adding', () => {
    expect(kinds(base)).toEqual(['Zurich:start', 'Luzern:via', 'Bern:end']);
  });

  it('round trip appends the start and inserts new stops before it', () => {
    const rt = setRoundTrip(base, true);
    expect(isRoundTrip(rt)).toBe(true);
    expect(kinds(rt)).toEqual(['Zurich:start', 'Luzern:via', 'Bern:via', 'Zurich:end']);
    expect(kinds(addWaypoint(rt, s('Chur'))).at(-2)).toBe('Chur:via');
    expect(kinds(setRoundTrip(rt, false))).toEqual(kinds(base));
    expect(setRoundTrip(rt, true)).toBe(rt);
  });

  it('stop with dwell, back to ride-through clears dwell', () => {
    const t = setStop(base, 1, true);
    expect(t.waypoints[1]).toMatchObject({ kind: 'stop', dwellMin: 30 });
    expect(setDwell(t, 1, 60).waypoints[1]!.dwellMin).toBe(60);
    expect(setDwell(t, 1, -5).waypoints[1]!.dwellMin).toBe(0);
    expect(setStop(t, 1, false).waypoints[1]).toMatchObject({ kind: 'via', dwellMin: 0 });
  });

  it('moving renormalises kinds and drops dwell on the new start', () => {
    const t = moveWaypoint(setStop(base, 1, true), 1, 0);
    expect(kinds(t)).toEqual(['Luzern:start', 'Zurich:via', 'Bern:end']);
    expect(t.waypoints[0]!.dwellMin).toBe(0);
  });

  it('removing the end promotes the previous waypoint', () => {
    expect(kinds(removeWaypoint(base, 2))).toEqual(['Zurich:start', 'Luzern:end']);
  });
});
