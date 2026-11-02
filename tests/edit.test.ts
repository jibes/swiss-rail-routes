import { describe, expect, it } from 'vitest';
import {
  addWaypoint,
  moveWaypoint,
  newTour,
  setStay,
  removeWaypoint,
  setDwell,
  setRoundTrip,
  setStop,
  insertTemplate,
  replaceWaypoint,
} from './helpers/edit';
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

describe('insertTemplate', () => {
  const albula = {
    id: 'albula',
    chain: ['Chur', 'Thusis', 'Filisur', 'Preda', 'StMoritz'].map((n) => ({
      ref: `ch:1:sloid:${n}`,
      name: n,
    })),
    mustPass: ['Thusis', 'Preda'].map((n) => `ch:1:sloid:${n}`),
  };

  it('adds ends and must-pass stops, tagged, before the round-trip end', () => {
    const t = insertTemplate(
      setRoundTrip(addWaypoint(newTour('t', '2026-11-07', s('Zurich')), s('Chur')), true),
      albula,
    );
    expect(kinds(t)).toEqual([
      'Zurich:start',
      'Chur:via',
      'Thusis:via',
      'Preda:via',
      'StMoritz:via',
      'Zurich:end',
    ]);
    expect(t.waypoints.map((w) => w.templateId ?? '-')).toEqual([
      '-',
      'albula',
      'albula',
      'albula',
      'albula',
      '-',
    ]);
  });

  it('runs reversed', () => {
    const t = insertTemplate(newTour('t', '2026-11-07', s('Zurich')), albula, true);
    expect(kinds(t)).toEqual([
      'Zurich:start',
      'StMoritz:via',
      'Preda:via',
      'Thusis:via',
      'Chur:end',
    ]);
  });
});

describe('replaceWaypoint', () => {
  it('swaps a station in place, keeping its stay', () => {
    const t = setStop(
      addWaypoint(addWaypoint(newTour('t', '2026-11-07', s('Zurich')), s('Luzern')), s('Bern')),
      1,
      true,
      60,
    );
    const r = replaceWaypoint(t, 1, s('Zug'));
    expect(r.waypoints[1]).toMatchObject({ name: 'Zug', kind: 'stop', dwellMin: 60 });
  });

  it('changes start and return together in a round trip', () => {
    const t = setRoundTrip(addWaypoint(newTour('t', '2026-11-07', s('Zurich')), s('Luzern')), true);
    const r = replaceWaypoint(t, 0, s('Winterthur'));
    expect(kinds(r)).toEqual(['Winterthur:start', 'Luzern:via', 'Winterthur:end']);
  });
});

describe('setStay', () => {
  const base = () => {
    let t = newTour('s', '2026-11-14', { stopRef: 'a', name: 'A' });
    t = addWaypoint(t, { stopRef: 'b', name: 'B' });
    return addWaypoint(t, { stopRef: 'c', name: 'C' });
  };
  it('gets off for a stay, rides through at 0, changes a stay in place', () => {
    const off = setStay(base(), 1, 60);
    expect(off.waypoints[1]).toMatchObject({ kind: 'stop', dwellMin: 60 });
    expect(setStay(off, 1, 90).waypoints[1]).toMatchObject({ kind: 'stop', dwellMin: 90 });
    expect(setStay(off, 1, 0).waypoints[1]).toMatchObject({ kind: 'via', dwellMin: 0 });
  });
  it('leaves start and end alone', () => {
    const t = base();
    expect(setStay(t, 0, 30)).toBe(t);
    expect(setStay(t, 2, 30)).toBe(t);
  });
});

describe('round trip ends', () => {
  const loop = () => {
    let t = newTour('l', '2026-11-14', { stopRef: 'a', name: 'A' });
    t = addWaypoint(t, { stopRef: 'b', name: 'B' });
    t = addWaypoint(t, { stopRef: 'c', name: 'C' });
    return setRoundTrip(t, true); // A B C A
  };
  const names = (t: ReturnType<typeof loop>) => t.waypoints.map((w) => `${w.name}:${w.kind}`);

  it('removing the start or the return removes both and closes on the new first station', () => {
    expect(names(removeWaypoint(loop(), 0))).toEqual(['B:start', 'C:via', 'B:end']);
    expect(names(removeWaypoint(loop(), 3))).toEqual(['B:start', 'C:via', 'B:end']);
  });

  it('the start and the return do not move; stations between them do', () => {
    const t = loop();
    expect(moveWaypoint(t, 3, 1)).toBe(t);
    expect(moveWaypoint(t, 0, 2)).toBe(t);
    expect(moveWaypoint(t, 1, 3)).toBe(t);
    expect(names(moveWaypoint(t, 1, 2))).toEqual(['A:start', 'C:via', 'B:via', 'A:end']);
  });
});
