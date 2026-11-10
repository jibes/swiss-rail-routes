import { describe, expect, it } from 'vitest';
import type { LiveCall } from '../src/core/ojp/journey';
import { wholeRun } from '../src/core/run';

const c = (key: string, dep: string): LiveCall => ({
  key,
  name: key,
  dep: `2026-11-07T${dep}:00Z`,
  passed: false,
  cancelled: false,
});
const calls = [c('A', '08:00'), c('B', '08:10'), c('C', '08:20'), c('D', '08:30'), c('E', '08:40')];
const ride = (from: string, to: string) => ({
  from: { stopRef: from, name: from },
  to: { stopRef: to, name: to },
});

describe('a train’s whole run (0.45.0)', () => {
  it('every stop it calls at, the part you ride marked', () => {
    const r = wholeRun(calls, ride('B', 'D'));
    expect(r.map((x) => x.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r.map((x) => x.yours)).toEqual([false, true, true, true, false]);
  });

  it('a loop passing a station twice: from your boarding to the alighting after it', () => {
    const loop = [...calls, c('B', '08:50'), c('F', '09:00')];
    expect(wholeRun(loop, ride('D', 'B')).map((x) => x.yours)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('where you ride is not in the answer: nothing marked', () => {
    expect(wholeRun(calls, ride('X', 'D')).some((x) => x.yours)).toBe(false);
  });
});
