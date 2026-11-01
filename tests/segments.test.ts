import { describe, expect, it } from 'vitest';
import type { Segment } from '../src/core/data';
import { usesSegment } from '../src/core/segments';

const gotthard: Segment = {
  id: 'gotthard-base',
  name: 'Gotthard base tunnel',
  a: ['arth', 'erstfeld'],
  b: ['bellinzona', 'lugano'],
  via: ['goeschenen', 'airolo'],
};

describe('usesSegment', () => {
  it('flags a ride between the ends that skips the via stops', () => {
    expect(usesSegment(['zurich', 'arth', 'bellinzona', 'lugano'], gotthard)).toBe(true);
    expect(usesSegment(['lugano', 'bellinzona', 'erstfeld'], gotthard)).toBe(true);
  });

  it('passes the mountain line', () => {
    expect(
      usesSegment(['arth', 'erstfeld', 'goeschenen', 'airolo', 'bellinzona', 'lugano'], gotthard),
    ).toBe(false);
  });

  it('ignores rides touching only one end', () => {
    expect(usesSegment(['zurich', 'arth', 'luzern'], gotthard)).toBe(false);
    expect(usesSegment(['locarno', 'bellinzona', 'lugano'], gotthard)).toBe(false);
  });

  it('handles segments without via (any direct ride counts)', () => {
    const vereina = { ...gotthard, a: ['klosters'], b: ['sagliains'], via: [] };
    expect(usesSegment(['landquart', 'klosters', 'sagliains'], vereina)).toBe(true);
    expect(usesSegment(['landquart', 'klosters', 'davos'], vereina)).toBe(false);
  });
});
