import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { minutesOf, OjpError, parseTrips } from '../src/core/ojp/parse';
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

  it('treats "no trip found" as no connections, other problems as errors', () => {
    const raw = (n: string) => readFileSync(`tests/fixtures/ojp/errors/${n}.xml`, 'utf8');
    expect(parseTrips(raw('notripfound'))).toEqual([]);
    expect(() => parseTrips(raw('identical'))).toThrow('TRIP_ORIGINDESTINATIONIDENTICAL');
  });

  it('rejects what is not a trip delivery', () => {
    expect(() => parseTrips('<html/>')).toThrow(OjpError);
  });

  it('a walk keeps its minutes, and a connection starts with its walk to the first ride', () => {
    // T1: from Thusis station to the replacement bus outside it, 2 minutes on foot.
    const c = load('T1', '229ff10bdf30')[0]!;
    const walk = c.sections[0]!;
    expect(walk).toMatchObject({ mode: 'walk', walkMin: 2 });
    const ride = rides(c)[0]![0];
    expect(Date.parse(ride.from.dep!) - Date.parse(c.dep)).toBe(2 * 60_000);
    expect(c.dep).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/);
    expect(minutesOf('PT1H4M30S')).toBe(65);
    expect(minutesOf(undefined)).toBeUndefined();
  });

  it('drops a cancelled train and the stops a train no longer serves', () => {
    const xml = gunzipSync(readFileSync('tests/fixtures/ojp/T5/fceaee61013c.xml.gz')).toString();
    const all = parseTrips(xml);
    // The first trip's first train cancelled: that trip goes, the others stay.
    const cancelled = xml.replace('<Service>', '<Service><Cancelled>true</Cancelled>');
    expect(parseTrips(cancelled)).toHaveLength(all.length - 1);
    // A stop on the way not served: it is no longer on the ride.
    const first = rides(all[0]!)[0]![0];
    const skipped = first.intermediate[0]!;
    const notServed = xml.replace(
      '<LegIntermediate>',
      '<LegIntermediate><NotServicedStop>true</NotServicedStop>',
    );
    const after = rides(parseTrips(notServed)[0]!)[0]![0];
    expect(after.intermediate.map((x) => x.name)).not.toContain(skipped.name);
  });

  it('how full a train is expected to be: the fullest you ride it, per class (0.39.0)', () => {
    const xml = gunzipSync(readFileSync('tests/fixtures/ojp/T1/b865ad45f13a.xml.gz')).toString();
    const all = parseTrips(xml).flatMap((c) => rides(c).map(([s]) => s));
    // SBB's trains say it for both classes (second written \`secondClass \`, with a space); the
    // RhB's say nothing.
    const ic = all.filter((s) => s.line === 'IC3' && s.occupancy);
    expect(ic.length).toBeGreaterThan(0);
    for (const s of ic) expect(s.occupancy).toEqual([1, 1]);
    expect(all.find((s) => s.line === 'IR35')?.occupancy).toEqual([1, 2]);
    expect(all.filter((s) => s.line === 'RE13').every((s) => !s.occupancy)).toBe(true);
    // Standing room only in second class: said for second, first as it was.
    const crowded = parseTrips(
      xml.replaceAll(
        /(secondClass\s*<\/siri:FareClass><siri:OccupancyLevel>)\w+/g,
        '$1standingRoomOnly',
      ),
    )
      .flatMap((c) => rides(c).map(([s]) => s))
      .filter((s) => s.line === 'IC3' && s.occupancy);
    expect(crowded.length).toBe(ic.length);
    for (const [i, s] of crowded.entries()) {
      expect(s.occupancy?.[1]).toBe(3);
      expect(s.occupancy?.[0]).toBe(ic[i]!.occupancy?.[0]);
    }
  });
});

// Reported on the MCP, 5 Nov 2026: a disruption came as its headline only. A situation's
// validity, the stops it names and the operator's remarks come with it now.
describe('a notice in full', () => {
  it('until when, which stops, and what the operator adds (Albula closure, 6 Nov 2026)', () => {
    const xml = gunzipSync(readFileSync('tests/fixtures/ojp/B1R/2716ea195948.xml.gz')).toString();
    const rides = parseTrips(xml).flatMap((c) => c.sections);
    const s = rides.find((x) => x.notices?.some((n) => n.includes('Thusis und Preda')))!;
    const i = s.notices!.findIndex((n) => n.includes('Thusis und Preda'));
    const info = s.noticeInfo![i]!;
    expect(info.until).toBe('2026-11-13T22:30:00Z');
    expect(info.detail).toMatch(/Ersatzbusse/);
  });
});
