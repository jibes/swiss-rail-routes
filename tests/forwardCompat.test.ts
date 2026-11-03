// A field this version does not know (a newer version on another device added it) survives
// being loaded and saved here, and is no edit: synced lists must not strip or outdate it.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOf } from '../src/core/sync';
import { newTrip } from '../src/core/trip';
import { newTour } from './helpers/edit';

beforeEach(() => {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
});

describe('what a newer version saved', () => {
  it('a past trip keeps its unknown field through load and save, hashed the same', async () => {
    const { toursList } = await import('../src/io/tours');
    const tour = { ...newTour('a', '2026-11-07'), name: 'Albula', later: { added: 'in 0.16' } };
    await toursList.save([], [tour], true);
    const [back] = await toursList.load();
    expect(back).toMatchObject({ later: { added: 'in 0.16' } });
    expect(hashOf(back)).toBe(hashOf(tour));
    // Saved again from here (another item changes), still there.
    await toursList.save(
      [back!],
      [back!, { ...newTour('b', '2026-11-08'), name: 'Gotthard' }],
      true,
    );
    expect((await toursList.load()).find((t) => t.id === 'a')).toMatchObject({
      later: { added: 'in 0.16' },
    });
  });

  it('a trip too', async () => {
    const { tripsList } = await import('../src/io/trips');
    const trip = {
      ...newTrip('t', newTour('t', '2026-11-07'), undefined, undefined, new Date(0)),
      mood: 'new',
    };
    await tripsList.save([], [trip], true);
    const [back] = await tripsList.load();
    expect(back).toMatchObject({ mood: 'new' });
    expect(hashOf(back)).toBe(hashOf(trip));
  });
});
