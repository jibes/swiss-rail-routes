import { describe, expect, it } from 'vitest';
import { sbbUrl } from '../src/core/export/sbb';
import type { Waypoint } from '../src/core/model';

const w = (name: string): Waypoint => ({ stopRef: name, name, kind: 'via', dwellMin: 0 });

describe('sbbUrl', () => {
  it('carries from, to, up to 3 vias, Swiss date and time', () => {
    const u = new URL(
      sbbUrl(
        { index: 0, from: w('Zürich HB'), to: w('Mürren BLM'), vias: ['A', 'B', 'C', 'D'].map(w) },
        '2026-11-07',
        '08:09',
      ),
    );
    expect(u.hostname).toBe('www.sbb.ch');
    expect(u.searchParams.get('von')).toBe('Zürich HB');
    expect(u.searchParams.get('nach')).toBe('Mürren BLM');
    expect(u.searchParams.get('datum')).toBe('07.11.2026');
    expect(u.searchParams.get('zeit')).toBe('08:09');
    expect(u.searchParams.get('via3')).toBe('C');
    expect(u.searchParams.has('via4')).toBe(false);
  });
});
