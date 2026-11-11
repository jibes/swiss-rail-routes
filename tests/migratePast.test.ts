// Bringing back the routes kept as "your trips" before 0.52.0 (src/io/migratePast.ts), review of
// 11 Nov 2026: items this version cannot read stay; a route retired again by an older tab comes
// back under its own id, not a longer one each time.
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { expect, it, vi } from 'vitest';
import { tripIdOf } from '../src/core/pastTrips';

vi.mock('../src/io/log', () => ({ log: () => undefined }));

const wp = (name: string, n: number, kind: string) => ({
  stopRef: `ch:1:sloid:${n}`,
  name,
  kind,
  dwellMin: 0,
});
const tour = (id: string) => ({
  id,
  name: id,
  date: '2026-10-01',
  anchor: { departAt: '08:00' },
  ticket: 'GA',
  travelClass: 2,
  schema: 1,
  waypoints: [wp('Chur', 9000, 'start'), wp('Arosa', 9157, 'end')],
});

it('keeps what it cannot read, in both lists, and turns the rest into trips', async () => {
  await set('srr.trips.v1', [{ id: 'newer', v2route: {} }]);
  await set('srr.tours.v1', [tour('past-a'), { id: 'newerTour', weird: 1 }]);
  const { useTrips } = await import('../src/trips');
  const { useTours } = await import('../src/tours');
  await useTrips.getState().load();
  await useTours.getState().load();
  const { migratePastTrips } = await import('../src/io/migratePast');
  await migratePastTrips(new Date(0));
  const ids = async (k: string) => ((await get(k)) as { id: string }[]).map((x) => x.id).sort();
  expect(await ids('srr.trips.v1')).toEqual(['newer', 'past-a']);
  expect(await ids('srr.tours.v1')).toEqual(['newerTour']);
});

it('a route retired again by an older version comes back under its own id', () => {
  expect(tripIdOf('past-past-past-a')).toBe('past-a');
  expect(tripIdOf('past-a')).toBe('past-a');
  expect(tripIdOf('shared-x')).toBe('shared-x');
});
