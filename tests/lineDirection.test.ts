// Which way a scenic line runs where it is put (src/core/lineDirection.ts): each rule in turn.
import { describe, expect, it } from 'vitest';
import { lineReversed } from '../src/core/lineDirection';

// A line from A to B, 50 km apart west to east.
const tp = {
  chain: [
    { ref: 'ch:1:sloid:1', name: 'A' },
    { ref: 'ch:1:sloid:2', name: 'B' },
  ],
};
const at = {
  'ch:1:sloid:1': { lat: 47, lon: 8, modes: ['TRAIN'] },
  'ch:1:sloid:2': { lat: 47, lon: 8.66, modes: ['TRAIN'] },
} as Record<string, { lat: number; lon: number; modes?: string[] }>;
const stop = (r: string) => at[r];

describe('which way a scenic line runs', () => {
  it('towards the station after it when that is one of its ends', () => {
    expect(lineReversed(tp, { after: { ref: 'ch:1:sloid:1' } }, stop)).toBe(true);
    expect(lineReversed(tp, { after: { ref: 'ch:1:sloid:2' } }, stop)).toBe(false);
  });

  it('from the station before when that is one of its ends', () => {
    expect(lineReversed(tp, { before: { ref: 'ch:1:sloid:2' } }, stop)).toBe(true);
    expect(lineReversed(tp, { before: { ref: 'ch:1:sloid:1' } }, stop)).toBe(false);
  });

  it('else from the end nearer the station before', () => {
    const east = { ref: 'x', at: { lat: 47, lon: 9 } };
    expect(lineReversed(tp, { before: east }, stop)).toBe(true);
    const west = { ref: 'y', at: { lat: 47, lon: 7.6 } };
    expect(lineReversed(tp, { before: west }, stop)).toBe(false);
  });

  it('two ends about as near: from the one trains call at (a summit’s valley)', () => {
    const summit = {
      'ch:1:sloid:1': { lat: 47, lon: 8.5 }, // a summit, no train
      'ch:1:sloid:2': { lat: 47.05, lon: 8.5, modes: ['TRAIN'] },
    } as Record<string, { lat: number; lon: number; modes?: string[] }>;
    const from = { ref: 'z', at: { lat: 47.3, lon: 8.5 } };
    expect(lineReversed(tp, { before: from }, (r) => summit[r])).toBe(true);
  });

  it('with no station before, towards the station after; nothing known, as written', () => {
    expect(lineReversed(tp, { after: { ref: 'w', at: { lat: 47, lon: 7.5 } } }, stop)).toBe(true);
    expect(lineReversed(tp, {}, stop)).toBe(false);
  });
});
