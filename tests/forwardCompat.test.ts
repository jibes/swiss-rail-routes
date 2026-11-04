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

describe('what this version cannot read', () => {
  it('is held as it came: not shown, written back untouched, given to sync', async () => {
    const { set, get } = await import('idb-keyval');
    const { tripsList } = await import('../src/io/trips');
    const readable = newTrip('t', newTour('t', '2026-11-07'), undefined, undefined, new Date(0));
    // A trip a newer version keeps in another shape (no `route` this version reads).
    const future = { id: 'f', journey: { v: 2, legs: ['Chur', 'Arosa'] } };
    await set('srr.trips.v1', [readable, future]);
    const loaded = await tripsList.load();
    expect(loaded.map((t) => t.id)).toEqual(['t']);
    expect(tripsList.held()).toEqual([future]);
    // Saved from here (the readable one changes): the held one is still stored, as it was.
    await tripsList.save(
      loaded,
      [{ ...loaded[0]!, route: { ...loaded[0]!.route, name: 'x' } }],
      true,
    );
    const stored = (await get('srr.trips.v1')) as { id: string }[];
    expect(stored.find((x) => x.id === 'f')).toEqual(future);
    expect(hashOf(tripsList.held()[0])).toBe(hashOf(future));
  });

  it('a past trip too; and a list sync gives back keeps it held, a newer one replacing it', async () => {
    const { set, get } = await import('idb-keyval');
    const { toursList } = await import('../src/io/tours');
    const future = { id: 'f', stations: 'v2' };
    await set('srr.tours.v1', [future]);
    expect(await toursList.load()).toEqual([]);
    const tour = { ...newTour('a', '2026-11-07'), name: 'Albula' };
    const newer = { id: 'f', stations: 'v3' };
    const { items, saved } = toursList.replace([], [tour, newer]);
    await saved;
    expect(items).toEqual([tour]);
    expect(toursList.held()).toEqual([newer]);
    expect(((await get('srr.tours.v1')) as { id: string }[]).find((x) => x.id === 'f')).toEqual(
      newer,
    );
    // Gone from what sync gives back (deleted elsewhere): gone here too.
    await toursList.replace(items, [tour]).saved;
    expect(((await get('srr.tours.v1')) as { id: string }[]).map((x) => x.id)).toEqual(['a']);
  });
});
