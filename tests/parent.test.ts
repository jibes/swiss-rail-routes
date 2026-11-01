import { describe, expect, it } from 'vitest';
import { parentOf } from '../src/core/parent';

describe('parentOf', () => {
  it('has none on the main list', () => {
    expect(parentOf('/')).toBeUndefined();
    expect(parentOf('')).toBeUndefined();
    expect(parentOf('/trips')).toBeUndefined();
  });
  it('goes up one level from a screen of an idea or a trip', () => {
    expect(parentOf('/tour/a1/plan')).toBe('/tour/a1');
    expect(parentOf('/tour/a1/map?s=x')).toBe('/tour/a1');
    expect(parentOf('/trip/b2/edit')).toBe('/trip/b2');
    expect(parentOf('/trip/b2/map')).toBe('/trip/b2');
  });
  it('goes to the list from everything else', () => {
    expect(parentOf('/tour/a1?s=x')).toBe('/');
    expect(parentOf('/trip/b2')).toBe('/');
    expect(parentOf('/settings')).toBe('/');
    expect(parentOf('/j/abc')).toBe('/');
    expect(parentOf('/r/slug.1')).toBe('/');
  });
});
