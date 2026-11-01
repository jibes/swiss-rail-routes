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
});
