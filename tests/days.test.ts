// Where a trip's day changes (0.50.1): by the first time on the new day, arrival or departure.
import { describe, expect, it } from 'vitest';
import { dayMarks } from '../src/core/days';
import type { LineRow, StationRow } from '../src/core/rows';

const st = (name: string, arr?: string, dep?: string): StationRow => ({
  type: 'station',
  name,
  key: name,
  role: 'stop',
  ...(arr ? { arr } : {}),
  ...(dep ? { dep } : {}),
});

describe('dayMarks', () => {
  it('a stay into the next day: the day by the departure, not the evening’s arrival', () => {
    const rows: LineRow[] = [
      st('Zürich HB', undefined, '2026-11-07T16:00:00Z'),
      st('Lugano', '2026-11-07T19:00:00Z', '2026-11-08T08:15:00Z'),
      st('Bern', '2026-11-08T11:00:00Z'),
    ];
    expect([...dayMarks(rows, '2026-11-07', new Set())]).toEqual([[1, { dep: '2026-11-08' }]]);
  });

  it('a train arriving after midnight: the day by the arrival', () => {
    const rows: LineRow[] = [
      st('Zürich HB', undefined, '2026-11-07T21:00:00Z'),
      st('Chur', '2026-11-07T23:10:00Z', '2026-11-07T23:20:00Z'),
    ];
    // 23:10 UTC is 00:10 in Zurich: the next day from the arrival on.
    expect([...dayMarks(rows, '2026-11-07', new Set())]).toEqual([[1, { arr: '2026-11-08' }]]);
  });

  it('a trip on another day than its own at the start; rows inside a ride passed over', () => {
    const rows: LineRow[] = [
      st('A', undefined, '2026-11-08T08:00:00Z'),
      st('B', '2026-11-09T08:00:00Z'),
    ];
    expect([...dayMarks(rows, '2026-11-07', new Set())]).toEqual([
      [0, { dep: '2026-11-08' }],
      [1, { arr: '2026-11-09' }],
    ]);
    expect([...dayMarks(rows, '2026-11-07', new Set([1]))]).toEqual([[0, { dep: '2026-11-08' }]]);
  });
});
