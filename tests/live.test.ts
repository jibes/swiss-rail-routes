import { describe, expect, it } from 'vitest';
import { journeysToWatch, liveState } from '../src/core/live';
import type { JourneyStatus } from '../src/core/ojp/journey';
import { zurichDateTime } from '../src/core/ojp/request';
import { DATE, conn, ref, ride } from './helpers/timetable';

const at = (hhmm: string) => Date.parse(zurichDateTime(`${DATE}T${hhmm}`));
const iso = (hhmm: string) => new Date(at(hhmm)).toISOString();

// Zürich 08:04 → Luzern 08:45 (IR 70), change 6 min, Luzern 08:51 → Interlaken Ost 10:41 (LIX).
const chain = [
  conn(
    ride(
      'IR 70',
      [
        ['Zürich HB', '08:04'],
        ['Zug', '08:25'],
        ['Luzern', '08:45'],
      ],
      { journey: 'j1' },
    ),
    ride(
      'PE LIX',
      [
        ['Luzern', '08:51'],
        ['Sarnen', '09:15'],
        ['Interlaken Ost', '10:41'],
      ],
      { journey: 'j2' },
    ),
  ),
];

describe('liveState', () => {
  it('before the trip: next is boarding the first train', () => {
    const s = liveState(chain, at('07:50'));
    expect(s.phase).toBe('before');
    expect(s.next).toMatchObject({ kind: 'board', ride: 0, delayMin: 0 });
    expect(s.next!.stop.name).toBe('Zürich HB');
    expect(s.progress).toBe(0);
  });

  // Third audit, 11 Nov 2026: a stop without times (walked through, stitched in) counted as 0,
  // and the marker jumped past it to almost the next stop.
  it('riding past a stop without times: placed between its neighbours', () => {
    const c = conn(
      ride(
        'IR 70',
        [
          ['Zürich HB', '08:04'],
          ['Zug', '08:25'],
          ['Luzern', '08:45'],
        ],
        { journey: 'j1' },
      ),
    );
    const s0 = c.sections[0]!;
    const zug = s0.intermediate[0]!;
    const blank = { ...zug, stopRef: ref('Baar'), name: 'Baar', arr: undefined, dep: undefined };
    const odd = { ...c, sections: [{ ...s0, intermediate: [zug, blank] }] };
    const s = liveState([odd], at('08:28'));
    expect(s.between!.i).toBe(1); // Zug → Baar, not past it
    expect(s.between!.fraction).toBeLessThan(0.5);
  });

  it('riding: between two stops, next is getting off', () => {
    const s = liveState(chain, at('08:35'));
    expect(s.phase).toBe('riding');
    expect(s.current).toBe(0);
    expect(s.between!.i).toBe(1); // Zug → Luzern
    expect(s.between!.fraction).toBeCloseTo(0.5, 1);
    expect(s.next).toMatchObject({ kind: 'alight', ride: 0 });
    expect(s.next!.stop.name).toBe('Luzern');
    expect(s.progress).toBeCloseTo(31 / 157, 3); // 08:04 → 08:35 of 08:04 → 10:41
  });

  it('waiting at a change: next is the onward train', () => {
    const s = liveState(chain, at('08:47'));
    expect(s.phase).toBe('waiting');
    expect(s.next).toMatchObject({ kind: 'board', ride: 1 });
    expect(journeysToWatch(s, at('08:47'))).toEqual(['j2']);
  });

  it('watches the train you are on; the next one only shortly before it leaves', () => {
    expect(journeysToWatch(liveState(chain, at('08:10')), at('08:10'))).toEqual(['j1']);
    expect(journeysToWatch(liveState(chain, at('08:40')), at('08:40'))).toEqual(['j1', 'j2']);
    expect(journeysToWatch(liveState(chain, at('10:42')), at('10:42'))).toEqual([]);
    // Before the trip or during a stay: the next train only once it leaves within 20 min.
    expect(journeysToWatch(liveState(chain, at('07:30')), at('07:30'))).toEqual([]);
    expect(journeysToWatch(liveState(chain, at('07:50')), at('07:50'))).toEqual(['j1']);
  });

  it('done after the last arrival', () => {
    expect(liveState(chain, at('10:42')).phase).toBe('done');
  });

  it('merges live delays and flags the connection at risk', () => {
    const late: JourneyStatus = {
      cancelled: false,
      calls: [
        {
          key: ref('Luzern'),
          name: 'Luzern',
          arr: iso('08:45'),
          arrEst: iso('08:50'),
          passed: false,
          cancelled: false,
        },
      ],
    };
    const s = liveState(chain, at('08:30'), new Map([['j1', late]]));
    expect(s.next).toMatchObject({ kind: 'alight', delayMin: 5 });
    expect(s.risks).toEqual([{ ride: 1, marginMin: 1, reason: 'tight' }]);
    const missed = { ...late, calls: [{ ...late.calls[0]!, arrEst: iso('08:55') }] };
    expect(liveState(chain, at('08:30'), new Map([['j1', missed]])).risks[0]!.reason).toBe(
      'missed',
    );
    expect(
      liveState(chain, at('08:30'), new Map([['j2', { cancelled: true, calls: [] }]])).risks[0]!
        .reason,
    ).toBe('cancelled');
  });

  it('a missed connection stays missed after the onward train has left', () => {
    const late: JourneyStatus = {
      cancelled: false,
      calls: [
        {
          key: ref('Luzern'),
          name: 'Luzern',
          arr: iso('08:45'),
          arrEst: iso('09:03'),
          passed: false,
          cancelled: false,
        },
      ],
    };
    // 09:10: arrived late at Luzern, the 08:51 has gone. Not "riding" the train missed.
    const s = liveState(chain, at('09:10'), new Map([['j1', late]]));
    expect(s.risks).toEqual([{ ride: 1, marginMin: -12, reason: 'missed' }]);
    expect(s.phase).toBe('waiting');
    expect(s.current).toBe(1);
  });

  it('says when the train no longer stops where you get off', () => {
    const skips: JourneyStatus = {
      cancelled: false,
      calls: [
        {
          key: ref('Interlaken Ost'),
          name: 'Interlaken Ost',
          arr: iso('10:41'),
          passed: false,
          cancelled: true,
        },
      ],
    };
    expect(liveState(chain, at('09:00'), new Map([['j2', skips]])).risks).toEqual([
      { ride: 1, marginMin: 0, reason: 'notServed', stop: 'Interlaken Ost' },
    ]);
  });

  it('a change already made is no longer at risk; a cancelled first train is', () => {
    const late: JourneyStatus = {
      cancelled: false,
      calls: [
        {
          key: ref('Luzern'),
          name: 'Luzern',
          arr: iso('08:45'),
          arrEst: iso('08:50'),
          passed: false,
          cancelled: false,
        },
      ],
    };
    // 09:00: on the onward train already, so the tight change at Luzern is behind.
    expect(liveState(chain, at('09:00'), new Map([['j1', late]])).risks).toEqual([]);
    const gone = new Map([['j1', { cancelled: true, calls: [] }]]);
    expect(liveState(chain, at('07:50'), gone).risks).toEqual([
      { ride: 0, marginMin: 0, reason: 'cancelled' },
    ]);
    // Cancelled onward train: said once, not also as a tight change.
    const both = new Map([
      ['j1', late],
      ['j2', { cancelled: true, calls: [] }],
    ]);
    expect(liveState(chain, at('08:30'), both).risks).toEqual([
      { ride: 1, marginMin: 0, reason: 'cancelled' },
    ]);
  });

  it('a through train (same journey) is never a connection at risk', () => {
    const through = [
      conn(
        ride(
          'IR 1',
          [
            ['Zürich HB', '08:00'],
            ['Zug', '08:20'],
          ],
          { journey: 'same' },
        ),
        ride(
          'IR 1',
          [
            ['Zug', '08:20'],
            ['Luzern', '08:40'],
          ],
          { journey: 'same' },
        ),
      ),
    ];
    expect(liveState(through, at('08:10')).risks).toEqual([]);
  });

  const late = (arrEst: string): JourneyStatus => ({
    cancelled: false,
    calls: [
      {
        key: ref('Luzern'),
        name: 'Luzern',
        arr: iso('08:45'),
        arrEst: iso(arrEst),
        passed: false,
        cancelled: false,
      },
    ],
  });

  it('a change missed by a minute counts as made once the train has left (Vallorcine)', () => {
    // Due 08:52 for the 08:51: said as missed before it leaves...
    const before = liveState(chain, at('08:50'), new Map([['j1', late('08:52')]]));
    expect(before.risks.map((r) => r.reason)).toEqual(['missed']);
    // ...but once it has left, you are on it, not held at Luzern for the rest of the trip.
    const s = liveState(chain, at('09:00'), new Map([['j1', late('08:52')]]));
    expect(s.phase).toBe('riding');
    expect(s.current).toBe(1);
    expect(s.risks).toEqual([]);
  });

  it('a change missed only by the plan’s estimate counts as made once the train has left', () => {
    // Planned with the IR 70 due 09:03 (no report since): the 08:51 is said as missed...
    const est = structuredClone(chain);
    est[0]!.sections[0]!.to.arrEst = iso('09:03');
    expect(liveState(est, at('08:50')).risks.map((r) => r.reason)).toEqual(['missed']);
    // ...but once it has left you are on it (0.63.3, Vallorcine: held for good, as a train
    // held at is never asked about again), unless the arriving train itself reported it.
    expect(liveState(est, at('09:10'))).toMatchObject({ phase: 'riding', current: 1, risks: [] });
    expect(liveState(est, at('09:10'), new Map([['j1', late('09:03')]])).phase).toBe('waiting');
  });

  it('a missed change holds you there, even after the missed train has arrived', () => {
    // The onward 08:51 would arrive 10:41; at 11:00 you are still in Luzern.
    const s = liveState(chain, at('11:00'), new Map([['j1', late('09:03')]]));
    expect(s.phase).toBe('waiting');
    expect(s.current).toBe(1);
    expect(s.risks.map((r) => r.reason)).toEqual(['missed']);
    // Nothing to ask about a train that has gone.
    expect(journeysToWatch(s, at('11:00'))).toEqual([]);
  });

  it('on board when your exit is not served: still riding, and told', () => {
    const skips: JourneyStatus = {
      cancelled: false,
      calls: [
        {
          key: ref('Interlaken Ost'),
          name: 'Interlaken Ost',
          arr: iso('10:41'),
          passed: false,
          cancelled: true,
        },
      ],
    };
    const s = liveState(chain, at('09:30'), new Map([['j2', skips]]));
    expect(s.phase).toBe('riding');
    expect(s.current).toBe(1);
    expect(s.risks[0]).toMatchObject({ reason: 'notServed', stop: 'Interlaken Ost' });
  });

  it('a walk counts: too little time for it is missed; its own time is not tight', () => {
    const walk = (min: number) => ({
      mode: 'walk' as const,
      walkMin: min,
      from: { stopRef: ref('Luzern'), name: 'Luzern' },
      to: { stopRef: ref('Luzern'), name: 'Luzern' },
      intermediate: [],
    });
    const withWalk = (min: number) => [
      conn(chain[0]!.sections[0]!, walk(min), chain[0]!.sections[1]!),
    ];
    // 6 min between the trains: a 4-min walk fits (not even tight), a 7-min one does not.
    expect(liveState(withWalk(4), at('08:30')).risks).toEqual([]);
    expect(liveState(withWalk(7), at('08:30')).risks[0]).toMatchObject({ reason: 'missed' });
  });
});
