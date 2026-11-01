// Sync engine (SPEC §3b): merges this device's routes and trips with the encrypted copy on the
// Worker. Runs on opening, when the app comes back into view, every minute while it is in view
// and a few seconds after a change. The decisions are planRound's (pure, tested); this file
// only reads, applies and writes.
import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import type { Tour } from '../core/model';
import {
  deriveKeys,
  formatKey,
  joinStamps,
  newKey,
  open,
  parseKey,
  planRound,
  seal,
  type Stamps,
  type SyncDoc,
} from '../core/sync';
import type { Trip } from '../core/trip';
import { useTours } from '../tours';
import { useTrips } from '../trips';
import { loadTours } from './tours';
import { loadTrips } from './trips';

const KEY = 'srr.sync.v1';

interface Saved {
  key: string;
  /** Server version last read or written; a lower one on the server means the copy was replaced. */
  v: number;
  stamps: { tours: Stamps; trips: Stamps };
  at?: number;
}

type Doc = SyncDoc<Tour, Trip>;

export type SyncStatus =
  'off' | 'syncing' | 'ok' | 'offline' | 'error' | 'replaced' | 'tooBig' | 'busy';

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

class SyncProblem extends Error {
  constructor(readonly status: SyncStatus) {
    super(status);
  }
}
class Conflict extends Error {}

/** A failed request: offline only when fetch itself failed (no answer at all). */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new SyncProblem('offline');
  }
}

const problemOf = (status: number): SyncStatus =>
  status === 410 ? 'replaced' : status === 413 ? 'tooBig' : status === 429 ? 'busy' : 'error';

async function remote(id: string, aes: CryptoKey): Promise<{ v: number; doc: Doc | null }> {
  const res = await request(`${base()}/sync/${id}`);
  if (res.status === 404) return { v: 0, doc: null };
  if (!res.ok) throw new SyncProblem(problemOf(res.status));
  const r = (await res.json()) as { v: number; data?: string };
  if (!r.data) return { v: r.v, doc: null };
  try {
    return { v: r.v, doc: await open<Doc>(r.data, aes) };
  } catch {
    throw new SyncProblem('error'); // not ours, or damaged: never overwrite it
  }
}

async function push(id: string, v: number, data: string): Promise<number> {
  const res = await request(`${base()}/sync/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v, data }),
  });
  if (res.status === 409) throw new Conflict();
  if (!res.ok) throw new SyncProblem(problemOf(res.status));
  return ((await res.json()) as { v: number }).v;
}

/** Other tabs of the app reload their lists when one tab applied a sync. */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('srr-sync');
channel?.addEventListener('message', () => {
  void loadTours().then((tours) => useTours.setState({ tours }));
  void loadTrips().then((trips) => useTrips.setState({ trips }));
});

/** One round: read, merge with what this device has now, apply, then write if needed. */
async function round(start: Saved): Promise<Saved> {
  const bytes = parseKey(start.key);
  if (!bytes) throw new SyncProblem('error');
  const { id, aes } = await deriveKeys(bytes);
  let saved = start;
  for (let attempt = 0; ; attempt++) {
    const { v, doc } = await remote(id, aes);
    // The copy was deleted or replaced (a new key elsewhere): never fill the old id again.
    if (saved.v > 0 && v < saved.v) throw new SyncProblem('replaced');
    // Read the lists only now: edits made while waiting for the server are part of this round.
    const now = Date.now();
    const plan = planRound({
      stamps: saved.stamps,
      local: { tours: useTours.getState().tours, trips: useTrips.getState().trips },
      remote: doc,
      now,
      lastSync: saved.at,
    });
    if (plan.apply.tours) await useTours.getState().replaceAll(plan.apply.tours);
    if (plan.apply.trips) await useTrips.getState().replaceAll(plan.apply.trips);
    if (plan.apply.tours || plan.apply.trips) channel?.postMessage('applied');
    // What this device now holds is the merge: remember it before writing, so a failed or
    // conflicting write never makes received items look like new local changes.
    saved = { ...saved, v, stamps: plan.stamps };
    await set(KEY, saved);
    if (!plan.push) return { ...saved, at: now };
    try {
      const next = await push(id, v, await seal({ v: 1, ...plan.merged } satisfies Doc, aes));
      return { ...saved, v: next, at: now };
    } catch (e) {
      if (e instanceof Conflict && attempt < 3) continue;
      throw e;
    }
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Syncs now. A call while a round runs queues one more round after it. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await once();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Rounds of all tabs one at a time (Web Locks where there are). */
const exclusive = (f: () => Promise<void>) =>
  navigator.locks ? navigator.locks.request('srr-sync', f) : f();

async function once() {
  const saved = await get<Saved>(KEY);
  if (!saved || !syncAvailable()) return;
  if (!useTours.getState().loaded || !useTrips.getState().loaded) return;
  useSync.setState({ status: 'syncing' });
  await exclusive(async () => {
    try {
      const next = await round(saved);
      // Turned off or given a new key meanwhile: keep what that did.
      if ((await get<Saved>(KEY))?.key !== saved.key) return;
      await set(KEY, next);
      useSync.setState({ status: 'ok', at: next.at ?? null });
    } catch (e) {
      if ((await get<Saved>(KEY))?.key !== saved.key) return;
      useSync.setState({ status: e instanceof SyncProblem ? e.status : 'error' });
    }
  });
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

/**
 * Starts sync with a new key, or joins with one from another device. What this device already
 * has counts as older than the shared copy, so joining never undoes newer changes made
 * elsewhere; items only this device has are added.
 */
export async function startSync(key = newKey()) {
  const bytes = parseKey(key);
  if (!bytes) return false;
  await running;
  const clean = formatKey(bytes);
  const stamps = {
    tours: joinStamps(useTours.getState().tours),
    trips: joinStamps(useTrips.getState().trips),
  };
  await set(KEY, { key: clean, v: 0, stamps } satisfies Saved);
  useSync.setState({ key: clean, status: 'syncing', at: null });
  await syncNow();
  return true;
}

/** This device stops syncing; its routes and trips stay. */
export async function stopSync() {
  await running;
  await del(KEY);
  useSync.setState({ key: null, status: 'off', at: null });
}

/**
 * A new key: everything moves to it and the old copy is closed (the Worker keeps a marker, so
 * devices still on the old key stop and say so instead of filling it again). The other
 * devices join again with the new key.
 */
export async function renewKey() {
  await running;
  const saved = await get<Saved>(KEY);
  const bytes = saved && parseKey(saved.key);
  if (bytes) {
    const { id } = await deriveKeys(bytes);
    await request(`${base()}/sync/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  await startSync();
}

const MINUTE = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Syncs on start, back in view, every minute in view, and 3 s after the last change. */
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
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible' && useSync.getState().key) void syncNow();
  }, MINUTE);
  return () => {
    a();
    b();
    clearTimeout(timer);
    clearInterval(tick);
    document.removeEventListener('visibilitychange', visible);
  };
}
