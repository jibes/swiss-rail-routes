// Which changes mark a trip as changed by you (`editedAt`, second audit of 11 Nov 2026): only a
// route edit. A plan, a reload or the rest changed under way leave it, or a past trip would be
// planned from a time gone (fromNow).
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { newTrip } from '../src/core/trip';
import { newTour } from './helpers/edit';

vi.mock('../src/io/log', () => ({ log: () => undefined }));

it('a route edit stamps editedAt; anything else leaves it', async () => {
  const { useTrips } = await import('../src/trips');
  await useTrips.getState().load();
  useTrips
    .getState()
    .add(newTrip('t', newTour('t', '2026-11-07'), undefined, undefined, new Date(0)));
  useTrips.getState().update('t', (x) => ({ ...x, name: 'renamed', quiet: true }));
  expect(useTrips.getState().trips[0]!.editedAt).toBeUndefined();
  useTrips.getState().editRoute('t', (r) => ({ ...r, date: '2026-11-08' }));
  const at = useTrips.getState().trips[0]!.editedAt;
  expect(at).toBeTypeOf('string');
  // The same route again is no edit.
  useTrips.getState().editRoute('t', (r) => r);
  expect(useTrips.getState().trips[0]!.editedAt).toBe(at);
});
