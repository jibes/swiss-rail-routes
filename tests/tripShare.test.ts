import { describe, expect, it } from 'vitest';
import { decodeTrip, encodeTrip } from '../src/core/export/tripShare';
import { plan } from '../src/core/planner/plan';
import { newTrip, revise } from '../src/core/trip';
import { ojpFor } from './acceptance/ojp';
import { acceptanceTours } from './acceptance/tours';
import { FIXTURE_DATE } from './acceptance/ojp';
import { ga, index, segments, templates } from './helpers/timetable';

describe('trip share link', async () => {
  const tour = acceptanceTours(FIXTURE_DATE).T3!;
  const r = await plan(tour, {
    ...ojpFor('T3'),
    templates,
    segments,
    ga,
    stop: (x) => index.byRef(x),
  });
  const trip = newTrip(
    'mine',
    { ...tour, name: 'Voralpen + Brünig' },
    r.legs!,
    r.recommended!,
    new Date(0),
  );

  it('round-trips the exact timetable with simplified tracks, without history or id', async () => {
    const withHistory = revise(
      trip,
      { route: trip.route, legs: trip.legs, chain: trip.chain },
      new Date(1),
    );
    const hash = await encodeTrip(withHistory);
    expect(hash).toMatch(/^#\/j\/[A-Za-z0-9_-]+$/);
    const back = (await decodeTrip(hash, 'theirs'))!;
    expect(back.id).toBe('theirs');
    expect(back.previous).toBeUndefined();
    expect(back.routeId).toBeUndefined();
    expect(back.name).toBe('Voralpen + Brünig');
    expect(back.chain.dep).toBe(trip.chain.dep);
    expect(back.chain.connections.map((c) => c.sections.map((s) => s.journey))).toEqual(
      trip.chain.connections.map((c) => c.sections.map((s) => s.journey)),
    );
    // Tracks come along, simplified: the map follows the rails, not straight lines.
    const sent = trip.chain.connections.flatMap((c) => c.sections);
    const got = back.chain.connections.flatMap((c) => c.sections);
    got.forEach((s, i) => {
      const g = sent[i]!.geometry;
      if (!g || g.length < 2) return expect(s.geometry).toBeUndefined();
      expect(s.geometry!.length).toBeGreaterThan(1);
      expect(s.geometry!.length).toBeLessThanOrEqual(g.length);
      expect(s.geometry![0]![0]).toBeCloseTo(g[0]![0], 4);
      expect(s.geometry!.at(-1)![1]).toBeCloseTo(g.at(-1)![1], 4);
    });
  });

  it('fits a link: a 3-leg day trip stays under 8000 characters', async () => {
    expect((await encodeTrip(trip)).length).toBeLessThan(8000);
  });

  it('rejects broken links', async () => {
    expect(await decodeTrip('#/j/AAAA', 'x')).toBeNull();
    expect(await decodeTrip('#/t/abc', 'x')).toBeNull();
  });
});
