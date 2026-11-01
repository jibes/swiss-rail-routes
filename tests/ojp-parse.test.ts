import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { OjpError, parseTrips } from '../src/core/ojp/parse';
import { rides } from '../src/core/planner/connection';
import { stopKey } from '../src/core/stops';
import { isSupplement } from '../src/core/warnings';
import { ga } from './helpers/timetable';

const load = (tour: string, key: string) =>
  parseTrips(gunzipSync(readFileSync(`tests/fixtures/ojp/${tour}/${key}.xml.gz`)).toString('utf8'));

describe('parseTrips on recorded OJP answers', () => {
  it('T5: rail then cog railway, platforms, UTC times, track, same-vehicle ids', () => {
    const cs = load('T5', 'fceaee61013c');
    expect(cs).toHaveLength(6);
    const c = cs[0]!;
    const r = rides(c).map(([s]) => s);
    expect(r.map((s) => [s.mode, s.line])).toEqual([
      ['rail', 'R62'],
      ['cog', '63'],
    ]);
    expect(r[0]!.from).toMatchObject({ name: 'Interlaken Ost', platform: '2A' });
    expect(stopKey(r[0]!.from.stopRef)).toBe('ch:1:sloid:7492');
    expect(c.dep).toBe(r[0]!.from.dep);
    expect(c.dep).toMatch(/^2026-11-07T\d\d:\d\d:00Z$/);
    expect(c.transfers).toBe(1);
    expect(r[0]!.geometry!.length).toBeGreaterThan(5);
    expect(r[0]!.journey).toMatch(/^2026-11-07:ch:1:sjyid:/);
    expect(c.sections.some((s) => s.mode === 'walk')).toBe(true);
    for (const s of r) {
      expect(s.intermediate.every((x) => x.arr && x.dep)).toBe(true);
      expect(Date.parse(s.to.arr!)).toBeGreaterThan(Date.parse(s.from.dep!));
    }
  });

  it('T1: Bernina Express is reservation-only; situations carry their text', () => {
    const cs = load('T1', '212c8a6bc9e5');
    const all = cs.flatMap((c) => rides(c).map(([s]) => s));
    const bex = all.filter((s) => s.product === 'BERNINA EXPRESS');
    expect(bex.length).toBeGreaterThan(0);
    for (const s of bex) {
      expect(s.reservationRequired).toBe(true);
      expect(isSupplement(s, ga)).toBe(true);
    }
    const noticed = all.filter((s) => s.situationIds?.length);
    expect(noticed.length).toBeGreaterThan(0);
    expect(noticed.every((s) => s.notices!.length > 0)).toBe(true);
  });

  it('T1: Albula replacement bus during the closure', () => {
    const r = load('T1', '229ff10bdf30').flatMap((c) => rides(c).map(([s]) => s));
    expect(r.some((s) => s.mode === 'bus' && s.category === 'EV')).toBe(true);
  });

  it('T3: the Luzern-Interlaken Express (category PE) is a regular train', () => {
    const lix = load('T3', '7314d2284af1')
      .flatMap((c) => rides(c).map(([s]) => s))
      .filter((s) => s.line === 'LIX');
    expect(lix.length).toBeGreaterThan(0);
    for (const s of lix) {
      expect(s.category).toBe('PE');
      expect(isSupplement(s, ga)).toBe(false);
    }
  });

  it('rejects what is not a trip delivery', () => {
    expect(() => parseTrips('<html/>')).toThrow(OjpError);
  });
});
