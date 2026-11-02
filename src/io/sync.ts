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
import { compactTrip, type Trip } from '../core/trip';
import { useTours } from '../tours';
import { useTrips } from '../trips';
import { log } from './log';
import { loadTours } from './tours';
import { loadTrips } from './trips';

const KEY = 'srr.sync.v1';
/** The last key's stamps after turning off, for turning on again with the same key. */
const LAST = 'srr.syncLast.v1';

interface Saved {
  key: string;
  /** How the last round ended, shown at the next start until a round runs. */
  status?: SyncStatus;
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
  /** The first round since opening is over (or there is no sync): retiring trips may run, as
   * it then sees what other devices changed (a trip moved to a later day stays). */
  settled: boolean;
  key: string | null;
  status: SyncStatus;
  at: number | null;
}

export const useSync = create<SyncState>()(() => ({
  loaded: false,
  settled: false,
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

/** A request that never answers (captive portal, dead connection) ends after this. */
const TIMEOUT_MS = 20_000;

/** A failed request: offline when fetch itself failed or timed out (no answer at all). */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
  } catch {
    throw new SyncProblem('offline');
  }
}

/** Larger than the Worker takes: said here instead of sending it (again) for nothing. */
const MAX_DATA = 1_000_000;

const problemOf = (status: number): SyncStatus =>
  status === 410 ? 'replaced' : status === 413 ? 'tooBig' : status === 429 ? 'busy' : 'error';

/**
 * The shared copy. `known`: the version this device last saw; when the Worker still holds it,
 * it answers `{v, same}` without the data (no download each minute), and the copy is what
 * this device's stamps describe.
 */
async function remote(
  id: string,
  aes: CryptoKey,
  known: number,
): Promise<{ v: number; doc: Doc | null; same?: boolean }> {
  const res = await request(`${base()}/sync/${id}${known ? `?v=${known}` : ''}`);
  if (res.status === 404) return { v: 0, doc: null };
  if (!res.ok) throw new SyncProblem(problemOf(res.status));
  const r = (await res.json()) as { v: number; data?: string; same?: boolean };
  if (r.same) return { v: r.v, doc: null, same: true };
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

/**
 * The shared copy as this device last saw it, rebuilt from its stamps (when the Worker said it
 * is unchanged): items as they are here, at the times the stamps hold; deletions as stamped.
 */
function asShared(stamps: Saved['stamps'], local: { tours: Tour[]; trips: Trip[] }): Doc {
  const side = <X extends { id: string }>(st: Stamps, items: X[]) =>
    Object.entries(st).map(([id, p]) => {
      const value = p.h ? items.find((x) => x.id === id) : undefined;
      return value ? { id, at: p.at, value } : { id, at: p.at };
    });
  return { v: 1, tours: side(stamps.tours, local.tours), trips: side(stamps.trips, local.trips) };
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
    const got = await remote(id, aes, saved.v);
    log('sync.read', {
      attempt,
      v: got.v,
      seen: saved.v,
      same: !!got.same,
      remote: got.doc && { routes: got.doc.tours.length, trips: got.doc.trips.length },
    });
    // A replaced key answers 410 (above). A version lower than the one seen: the copy expired
    // (unused for 180 days) and is written afresh from what this device has.
    const v = got.v < saved.v ? 0 : got.v;
    // Read the lists only now: edits made while waiting for the server are part of this round.
    const now = Date.now();
    const local = {
      tours: useTours.getState().tours,
      // Stored and shared compactly (simplified tracks), once per trip.
      trips: useTrips.getState().trips.map(compactTrip),
    };
    const plan = planRound({
      stamps: saved.stamps,
      local,
      remote: got.same ? asShared(saved.stamps, local) : got.doc,
      now,
      lastSync: saved.at,
    });
    log('sync.merge', {
      local: { routes: local.tours.length, trips: local.trips.length },
      applyRoutes: plan.apply.tours?.length,
      applyTrips: plan.apply.trips?.length,
      push: !!plan.push,
    });
    const store = useTrips.getState().trips;
    const trips =
      plan.apply.trips ?? (local.trips.some((t, i) => t !== store[i]) ? local.trips : undefined);
    // Both lists set first, then both saves awaited: an edit cannot slip in between.
    await Promise.all([
      plan.apply.tours && useTours.getState().replaceAll(plan.apply.tours),
      trips && useTrips.getState().replaceAll(trips),
    ]);
    if (plan.apply.tours || plan.apply.trips) channel?.postMessage('applied');
    // What this device now holds is the merge: remember it before writing, so a failed or
    // conflicting write never makes received items look like new local changes.
    saved = { ...saved, v, stamps: plan.stamps };
    await set(KEY, saved);
    if (!plan.push) return { ...saved, at: now };
    try {
      const data = await seal({ v: 1, ...plan.merged } satisfies Doc, aes);
      if (data.length > MAX_DATA) throw new SyncProblem('tooBig');
      const next = await push(id, v, data);
      log('sync.write', { v: next, chars: data.length });
      return { ...saved, v: next, at: now };
    } catch (e) {
      log('sync.write.fail', { attempt, conflict: e instanceof Conflict, e });
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
  if (!syncAvailable()) return;
  if (!useTours.getState().loaded || !useTrips.getState().loaded) return;
  await exclusive(async () => {
    // Read inside the lock: another tab may just have synced and saved newer stamps.
    const saved = await get<Saved>(KEY);
    if (!saved) return;
    useSync.setState({ status: 'syncing' });
    try {
      const next = await round(saved);
      // Turned off or given a new key meanwhile: keep what that did.
      if ((await get<Saved>(KEY))?.key !== saved.key) return;
      await set(KEY, { ...next, status: 'ok' });
      useSync.setState({ status: 'ok', at: next.at ?? null });
      log('sync.ok', { v: next.v });
    } catch (e) {
      const now = await get<Saved>(KEY);
      if (now?.key !== saved.key) return;
      const status = e instanceof SyncProblem ? e.status : 'error';
      log('sync.fail', { status, e });
      await set(KEY, { ...now, status });
      useSync.setState({ status });
    }
  });
}

export async function loadSync() {
  const saved = await get<Saved>(KEY);
  useSync.setState({
    loaded: true,
    key: saved?.key ?? null,
    status: saved ? (saved.status ?? 'ok') : 'off',
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
  // The same key again (sync turned off and on here): its stamps, so edits made meanwhile
  // count as the newer changes they are. Otherwise what this device has counts as older.
  const last = await get<{ key: string; stamps: Saved['stamps'] }>(LAST);
  const stamps =
    last?.key === clean
      ? last.stamps
      : {
          tours: joinStamps(useTours.getState().tours),
          trips: joinStamps(useTrips.getState().trips.map(compactTrip)),
        };
  await del(LAST);
  log('sync.start', { sameKeyAgain: last?.key === clean });
  await set(KEY, { key: clean, v: 0, stamps } satisfies Saved);
  useSync.setState({ key: clean, status: 'syncing', at: null });
  await syncNow();
  return true;
}

/**
 * This device stops syncing; its routes and trips stay. Never waits for a round (a stalled one
 * must not keep it on): a round that ends later sees the key gone and keeps nothing.
 */
export async function stopSync() {
  const saved = await get<Saved>(KEY);
  if (saved) await set(LAST, { key: saved.key, stamps: saved.stamps });
  log('sync.stop');
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
    // The old copy must really be closed (a leaked key is the reason for a new one): if the
    // Worker did not confirm it, nothing changes and it says so.
    const res = await request(`${base()}/sync/${id}`, { method: 'DELETE' }).catch(() => null);
    log('sync.renew', { status: res?.status ?? 'offline' });
    if (!res?.ok) {
      useSync.setState({ status: res ? problemOf(res.status) : 'offline' });
      return false;
    }
  }
  await startSync();
  return true;
}

const MINUTE = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Syncs on start, back in view, every minute in view, and 3 s after the last change. */
export function watchSync() {
  void loadSync()
    .then(syncNow)
    .catch(() => undefined)
    .finally(() => useSync.setState({ settled: true }));
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
