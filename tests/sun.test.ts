import { describe, expect, it } from 'vitest';
import { isAfterSunset, sunset } from '../src/core/sun';

const zurich = { lat: 47.3769, lon: 8.5417 };
const utcMinutes = (d: Date | null) => (d ? d.getUTCHours() * 60 + d.getUTCMinutes() : NaN);

describe('sunset', () => {
  // Published values for Zürich: 21.06. 21:26 CEST, 21.12. 16:37 CET.
  it('matches published times in Zürich within 3 min', () => {
    expect(Math.abs(utcMinutes(sunset('2026-06-21', zurich)) - (19 * 60 + 26))).toBeLessThanOrEqual(
      3,
    );
    expect(Math.abs(utcMinutes(sunset('2026-12-21', zurich)) - (15 * 60 + 37))).toBeLessThanOrEqual(
      3,
    );
  });

  it('falls on the requested day', () => {
    expect(sunset('2026-11-07', zurich)?.toISOString().slice(0, 10)).toBe('2026-11-07');
  });

  it('is earlier further east on the same day', () => {
    const bernina = { lat: 46.41, lon: 10.02 };
    expect(sunset('2026-11-07', bernina)!.getTime()).toBeLessThan(
      sunset('2026-11-07', zurich)!.getTime(),
    );
  });

  it('returns null in polar night', () => {
    expect(sunset('2026-12-21', { lat: 78.2, lon: 15.6 })).toBeNull();
  });
});

describe('isAfterSunset', () => {
  it('applies the 15 min margin', () => {
    const s = sunset('2026-11-07', zurich)!;
    const at = (minFromSunset: number) => new Date(s.getTime() + minFromSunset * 60_000);
    expect(isAfterSunset(at(-20), '2026-11-07', zurich)).toBe(false);
    expect(isAfterSunset(at(-10), '2026-11-07', zurich)).toBe(true);
    expect(isAfterSunset(at(30), '2026-11-07', zurich)).toBe(true);
  });
});
