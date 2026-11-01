// Sync engine (SPEC §3b): merges this device's routes and trips with the encrypted copy on the
// Worker. Runs on opening, when the app comes back into view, and a few seconds after a change.
import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import type { Tour } from '../core/model';
import {
  deriveKeys,
  formatKey,
  itemsOf,
  mergeEntries,
  newKey,
  open,
  parseKey,
  sameEntries,
  seal,
  stampLocal,
  stampsOf,
  type Entry,
  type Stamps,
  type SyncDoc,
} from '../core/sync';
import type { Trip } from '../core/trip';
import { useTours } from '../tours';
import { useTrips } from '../trips';

const KEY = 'srr.sync.v1';

interface Saved {
  key: string;
  /** Server version last read or written. */
  v: number;
  stamps: { tours: Stamps; trips: Stamps };
  at?: number;
}

type Doc = SyncDoc<Tour, Trip>;

export type SyncStatus = 'off' | 'syncing' | 'ok' | 'offline' | 'error';

interface SyncState {
  loaded: boolean;
  key: string | null;
  status: SyncStatus;
  at: number | null;
}

export const useSync = create<SyncState>()(() => ({
  loaded: false,
  key: null,
  status: 'off',
  at: null,
}));

const base = () => (import.meta.env.VITE_OJP_URL ?? '').replace(/[/]$/, '');
export const syncAvailable = () => !!base();

class Conflict extends Error {}

async function remote(id: string, aes: CryptoKey): Promise<{ v: number; doc: Doc | null }> {
  const res = await fetch(`${base()}/sync/${id}`, { cache: 'no-store' });
  if (res.status === 404) return { v: 0, doc: null }; // Workers before empty answered 200
  if (!res.ok) throw new Error(`sync ${res.status}`);
  const r = (await res.json()) as { v: number; data?: string };
  return { v: r.v, doc: r.data ? await open<Doc>(r.data, aes) : null };
}

async function push(id: string, v: number, data: string): Promise<number> {
  const res = await fetch(`${base()}/sync/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v, data }),
  });
  if (res.status === 409) throw new Conflict();
  if (!res.ok) throw new Error(`sync ${res.status}`);
  return ((await res.json()) as { v: number }).v;
}

let running: Promise<void> | null = null;

/** One round: read, merge, apply here, write back if the other side lacks something. */
async function round(saved: Saved): Promise<Saved> {
  const bytes = parseKey(saved.key);
  if (!bytes) throw new Error('key');
  const { id, aes } = await deriveKeys(bytes);
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const tours = useTours.getState().tours;
    const trips = useTrips.getState().trips;
    const mine = {
      tours: stampLocal(saved.stamps.tours, tours, now),
      trips: stampLocal(saved.stamps.trips, trips, now),
    };
    const { v, doc } = await remote(id, aes);
    const theirs = { tours: doc?.tours ?? [], trips: doc?.trips ?? [] };
    const merged = {
      tours: mergeEntries(mine.tours, theirs.tours as Entry<Tour>[], now),
      trips: mergeEntries(mine.trips, theirs.trips as Entry<Trip>[], now),
    };
    if (!sameEntries(merged.tours, mine.tours))
      useTours.getState().replaceAll(itemsOf(merged.tours, tours));
    if (!sameEntries(merged.trips, mine.trips))
      useTrips.getState().replaceAll(itemsOf(merged.trips, trips));
    let next = v;
    const changed =
      !doc || !sameEntries(merged.tours, theirs.tours) || !sameEntries(merged.trips, theirs.trips);
    if (changed) {
      try {
        next = await push(id, v, await seal({ v: 1, ...merged } satisfies Doc, aes));
      } catch (e) {
        if (e instanceof Conflict && attempt < 3) continue;
        throw e;
      }
    }
    return {
      ...saved,
      v: next,
      stamps: { tours: stampsOf(merged.tours), trips: stampsOf(merged.trips) },
      at: now,
    };
  }
}

/** Syncs now (one at a time; a call while one runs waits for it). */
export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const saved = await get<Saved>(KEY);
    if (!saved || !syncAvailable()) return;
    if (!useTours.getState().loaded || !useTrips.getState().loaded) return;
    useSync.setState({ status: 'syncing' });
    try {
      const next = await round(saved);
      // Turned off meanwhile: do not bring it back.
      if ((await get<Saved>(KEY))?.key !== saved.key) return;
      await set(KEY, next);
      useSync.setState({ status: 'ok', at: next.at ?? null });
    } catch (e) {
      useSync.setState({
        status: navigator.onLine && !(e instanceof TypeError) ? 'error' : 'offline',
      });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function loadSync() {
  const saved = await get<Saved>(KEY);
  useSync.setState({
    loaded: true,
    key: saved?.key ?? null,
    status: saved ? 'ok' : 'off',
    at: saved?.at ?? null,
  });
}

/** Starts sync with a new key, or joins with one from another device. */
export async function startSync(key = newKey()) {
  const bytes = parseKey(key);
  if (!bytes) return false;
  const clean = formatKey(bytes);
  await set(KEY, { key: clean, v: 0, stamps: { tours: {}, trips: {} } } satisfies Saved);
  useSync.setState({ key: clean, status: 'syncing', at: null });
  await syncNow();
  return true;
}

/** This device stops syncing; its routes and trips stay. */
export async function stopSync() {
  await del(KEY);
  useSync.setState({ key: null, status: 'off', at: null });
}

/**
 * A new key: everything moves to it and the old copy is deleted, so devices (or anyone) with
 * the old key no longer get anything. The other devices join again with the new key.
 */
export async function renewKey() {
  const saved = await get<Saved>(KEY);
  if (saved) {
    const bytes = parseKey(saved.key);
    if (bytes) {
      const { id } = await deriveKeys(bytes);
      await fetch(`${base()}/sync/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }
  await startSync();
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Syncs on start, when the app is back in view, and 3 s after the last change. */
export function watchSync() {
  void loadSync().then(syncNow);
  const later = () => {
    if (!useSync.getState().key) return;
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 3000);
  };
  const a = useTours.subscribe((s, p) => s.tours !== p.tours && later());
  const b = useTrips.subscribe((s, p) => s.trips !== p.trips && later());
  const visible = () => document.visibilityState === 'visible' && void syncNow();
  document.addEventListener('visibilitychange', visible);
  return () => {
    a();
    b();
    document.removeEventListener('visibilitychange', visible);
  };
}
