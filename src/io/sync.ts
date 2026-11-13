// Sync engine (SPEC §3b): merges this device's routes and trips with the encrypted copy on the
// Worker. Runs on opening, when the app comes back into view, every minute while it is in view
// and a few seconds after a change. The decisions are planRound's (pure, tested); this file
// only reads, applies and writes.
import { del, get, set, update } from 'idb-keyval';
import { create } from 'zustand';
import type { Tour } from '../core/model';
import {
  deriveKeys,
  DOC_V,
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
import { compactTrip, isOver, withoutTimetable, type Trip } from '../core/trip';
import { useTours } from '../tours';
import type { RecentStop } from '../core/recentStops';
import { useRecentStops } from '../ui/recentStops';
import { useTrips } from '../trips';
import { log } from './log';
import { toursList } from './tours';
import { tripsList } from './trips';

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
  /** The recent stations as last merged (0.48.1): the shared copy's, when it is unchanged. */
  recent?: RecentStop[];
  at?: number;
  /** A write was due and has not been confirmed: the next round downloads the copy in full
   * (never "unchanged" from stamps) and so writes again. */
  unsent?: boolean;
  /** Rounds in a row that failed after an answer, and when the last did: while a write is
   * unsent each round downloads the whole copy, so rounds back off (1, 2, 4 … 30 min). */
  fails?: number;
  failedAt?: number;
}

/** How long rounds wait after `fails` failures while a write is unsent. */
export const backoffMs = (fails: number) => Math.min(30, 2 ** Math.max(0, fails - 1)) * 60_000;

/** Sync was turned off or given another key while a round ran: that round keeps nothing. */
class Stopped extends Error {}

/** Saves `next` only while sync still runs on `key` (one transaction); otherwise stops. */
async function keepFor(key: string, next: Saved) {
  let ok = false;
  await update<Saved | undefined>(KEY, (cur) => {
    ok = cur?.key === key;
    return ok ? next : cur;
  });
  if (!ok) throw new Stopped();
}

type Doc = SyncDoc<Tour, Trip>;

export type SyncStatus =
  | 'off'
  | 'syncing'
  | 'ok'
  | 'offline'
  | 'error'
  | 'replaced'
  | 'tooBig'
  | 'busy'
  /** The copy was written by a newer version of the app: update this one to sync. */
  | 'update';

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
  let doc: Doc;
  try {
    doc = await open<Doc>(r.data, aes);
  } catch {
    throw new SyncProblem('error'); // not ours, or damaged: never overwrite it
  }
  // A format this version does not know: merging it could drop or trim what it cannot read,
  // and that would travel back to every device. Wait for the update instead.
  if (doc?.v !== 1 && doc?.v !== DOC_V) throw new SyncProblem('update');
  return { v: r.v, doc };
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
function asShared(
  stamps: Saved['stamps'],
  local: { tours: Tour[]; trips: Trip[] },
  recent: RecentStop[] | undefined,
): Doc {
  const side = <X extends { id: string }>(st: Stamps, items: X[]) =>
    Object.entries(st).map(([id, p]) => {
      const value = p.h ? items.find((x) => x.id === id) : undefined;
      return value ? { id, at: p.at, value } : { id, at: p.at };
    });
  return {
    v: DOC_V,
    tours: side(stamps.tours, local.tours),
    trips: side(stamps.trips, local.trips),
    ...(recent ? { recent } : {}),
  };
}

/** One round: read, merge with what this device has now, apply, then write if needed. */
/**
 * The merge, with what changed in the list since it was read (`before` → `now`) kept: an item
 * edited or added meanwhile as it is now, one deleted meanwhile left out.
 */
export function rebase<T extends { id: string }>(merged: T[], before: T[], now: T[]): T[] {
  if (now === before) return merged;
  const was = new Map(before.map((x) => [x.id, x]));
  const cur = new Map(now.map((x) => [x.id, x]));
  const out: T[] = [];
  const ids = new Set<string>();
  for (const m of merged) {
    ids.add(m.id);
    const b = was.get(m.id);
    const c = cur.get(m.id);
    if (b && !c) continue;
    out.push(c && c !== b ? c : m);
  }
  for (const c of now) if (!was.has(c.id) && !ids.has(c.id)) out.push(c);
  return out;
}

async function round(start: Saved): Promise<Saved> {
  const bytes = parseKey(start.key);
  if (!bytes) throw new SyncProblem('error');
  const { id, aes } = await deriveKeys(bytes);
  let saved = start;
  for (let attempt = 0; ; attempt++) {
    const got = await remote(id, aes, saved.unsent ? 0 : saved.v);
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
    const toursRead = useTours.getState().tours;
    const tripsRead = useTrips.getState().trips;
    // With what this version cannot read, held as it came: shared on, never deleted.
    const local = {
      tours: [...toursRead, ...(toursList.held() as Tour[])],
      // Stored and shared compactly (simplified tracks), once per trip.
      trips: [...tripsRead.map(compactTrip), ...(tripsList.held() as Trip[])],
      recent: useRecentStops.getState().stops,
    };
    const plan = planRound({
      stamps: saved.stamps,
      local,
      remote: got.same ? asShared(saved.stamps, local, saved.recent) : got.doc,
      now,
      lastSync: saved.at,
    });
    log('sync.merge', {
      local: { routes: local.tours.length, trips: local.trips.length },
      applyRoutes: plan.apply.tours?.length,
      applyTrips: plan.apply.trips?.length,
      applyRecent: plan.apply.recent?.length,
      push: !!plan.push,
    });
    const store = useTrips.getState().trips;
    const trips =
      plan.apply.trips ??
      (local.trips.some((t, i) => i < store.length && t !== store[i]) ? local.trips : undefined);
    // Turned off, or given a new key, while the server was asked: the shared copy is not
    // applied (turning sync off is also how one stops another device's copy coming in).
    if ((await get<Saved>(KEY))?.key !== start.key) throw new Stopped();
    // Both lists set first, then both saves awaited: an edit cannot slip in between. One made
    // while the server was asked is kept over the merge (third audit, 11 Nov 2026: a trip added
    // then was deleted, an edit reverted); the next round shares it.
    await Promise.all([
      plan.apply.tours &&
        useTours
          .getState()
          .replaceAll(rebase(plan.apply.tours, toursRead, useTours.getState().tours)),
      trips && useTrips.getState().replaceAll(rebase(trips, tripsRead, useTrips.getState().trips)),
    ]);
    if (plan.apply.recent) useRecentStops.setState({ stops: plan.apply.recent });
    // What this device now holds is the merge: remember it before writing, so a failed or
    // conflicting write never makes received items look like new local changes. Until the
    // write is confirmed it is `unsent`, so a failed one is tried again.
    saved = { ...saved, v, stamps: plan.stamps, recent: plan.merged.recent, unsent: !!plan.push };
    await keepFor(start.key, saved);
    if (!plan.push) return { ...saved, at: now };
    try {
      // A trip over is shared without its timetable (review, 0.65.1: every past trip's
      // connections made the copy grow until it was too big to sync at all). A device that has
      // it keeps its own planned copy (`itemsOf`: the same trip but for its timetable).
      // Items this version cannot read go as they came.
      const readable = (x: unknown): x is Trip =>
        !!x && typeof x === 'object' && 'chain' in x && 'route' in x && !!(x as Trip).route?.date;
      const trips = plan.merged.trips.map((e) =>
        readable(e.value) && e.value.chain && isOver(e.value, now)
          ? { ...e, value: { ...withoutTimetable(e.value), previous: undefined } }
          : e,
      );
      const data = await seal({ ...plan.merged, trips, v: DOC_V } satisfies Doc, aes);
      if (data.length > MAX_DATA) throw new SyncProblem('tooBig');
      const next = await push(id, v, data);
      log('sync.write', { v: next, chars: data.length });
      return { ...saved, v: next, at: now, unsent: false };
    } catch (e) {
      log('sync.write.fail', { attempt, conflict: e instanceof Conflict, e });
      if (e instanceof Conflict && attempt < 3) continue;
      throw e;
    }
  }
}

let running: Promise<void> | null = null;
let again = false;

let forced = false;

/** Syncs now. A call while a round runs queues one more round after it. `force` (the user's own
 * tap) skips the back-off after failures. */
export function syncNow(force = false): Promise<void> {
  forced ||= force;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      const f = forced;
      forced = false;
      await once(f);
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** How long a round waits for another tab's to end before giving up on this one. */
export const LOCK_WAIT_MS = 60_000;

/**
 * Rounds of all tabs one at a time (Web Locks where there are). A tab frozen by the browser in
 * the middle of its round keeps the lock until it is discarded: this round is given up after
 * LOCK_WAIT_MS (the next change or return to the app asks again) instead of every tab waiting
 * for good.
 */
async function exclusive(f: () => Promise<void>) {
  if (!navigator.locks) return f();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCK_WAIT_MS);
  try {
    await navigator.locks.request('srr-sync', { signal: ctrl.signal }, f);
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
    log('sync.lock.timeout', { ms: LOCK_WAIT_MS });
    // What waits for a first round (the past trips brought back) waits no longer for a tab
    // that may stay frozen (third audit).
    if (!useSync.getState().settled) useSync.setState({ settled: true });
  } finally {
    clearTimeout(timer);
  }
}

/** One round; storage failing on the way is logged, never an unhandled rejection. */
async function once(force = false) {
  try {
    await round1(force);
  } catch (e) {
    log('sync.storage.fail', { e });
    // Never left saying it syncs (second audit): storage gone mid-round is an error, an answer.
    if (useSync.getState().status === 'syncing')
      useSync.setState({ status: 'error', settled: true });
  }
}

async function round1(force: boolean) {
  if (!syncAvailable()) return;
  if (!useTours.getState().loaded || !useTrips.getState().loaded) return;
  // Lists that could not be read look empty: syncing them would delete everything elsewhere.
  if (useTours.getState().failed || useTrips.getState().failed) return;
  await exclusive(async () => {
    // Read inside the lock: another tab may just have synced and saved newer stamps.
    const saved = await get<Saved>(KEY);
    // Turned off, or a new key, in another tab: this tab shows what is stored.
    if (!saved) {
      if (useSync.getState().key) useSync.setState({ key: null, status: 'off', settled: true });
      return;
    }
    // The last rounds failed (a write unsent, a newer format, a copy it cannot read, busy):
    // each round downloads the whole copy (mobile data), so wait as the back-off says, unless
    // asked to now (review of 11 Nov 2026: only unsent writes waited; the rest asked every minute).
    if (
      !force &&
      saved.fails &&
      saved.failedAt &&
      Date.now() - saved.failedAt < backoffMs(saved.fails)
    ) {
      log('sync.wait', { fails: saved.fails, ms: backoffMs(saved.fails) });
      // What the server held was known at the last round (it answered): what waits on sync
      // settling (bringing back past trips) need not wait out the back-off too (second audit).
      if (saved.status !== 'offline') useSync.setState({ status: saved.status, settled: true });
      return;
    }
    useSync.setState({ key: saved.key, status: 'syncing' });
    try {
      const next = await round(saved);
      await keepFor(saved.key, { ...next, status: 'ok', fails: 0, failedAt: undefined });
      // The first round that reached the server: retiring may run now.
      useSync.setState({ status: 'ok', at: next.at ?? null, settled: true });
      log('sync.ok', { v: next.v });
    } catch (e) {
      // Turned off or given a new key meanwhile: keep what that did.
      if (e instanceof Stopped) return;
      const now = await get<Saved>(KEY);
      if (now?.key !== saved.key) return;
      const status = e instanceof SyncProblem ? e.status : 'error';
      log('sync.fail', { status, e });
      // Offline is no failure of the server: no back-off for it (nothing was downloaded).
      const fails = status === 'offline' ? (now.fails ?? 0) : (now.fails ?? 0) + 1;
      await keepFor(saved.key, {
        ...now,
        status,
        fails,
        failedAt: status === 'offline' ? now.failedAt : Date.now(),
      }).catch(() => undefined);
      // The server answered (replaced, too big, busy…): what it holds is known, so retiring may
      // run. Only offline it waits, as the other devices' changes are not in yet.
      useSync.setState(status === 'offline' ? { status } : { status, settled: true });
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
export async function startSync(key = newKey(), carry?: Saved['stamps']) {
  const bytes = parseKey(key);
  if (!bytes) return false;
  await running;
  const clean = formatKey(bytes);
  // The same key again (sync turned off and on here): its stamps, so edits made meanwhile
  // count as the newer changes they are. Otherwise what this device has counts as older.
  const last = await get<{ key: string; stamps: Saved['stamps']; at?: number }>(LAST);
  // A new key from this device (renewKey): its own stamps go along, with their real times
  // and deletions, so devices joining again with older copies lose ties as joiners should.
  const stamps =
    carry ??
    (last?.key === clean
      ? last.stamps
      : {
          tours: joinStamps([...useTours.getState().tours, ...toursList.held()]),
          trips: joinStamps([...useTrips.getState().trips.map(compactTrip), ...tripsList.held()]),
        });
  await del(LAST);
  log('sync.start', { sameKeyAgain: last?.key === clean });
  // When it last synced goes along (third audit, 11 Nov 2026: without it the guard against a
  // copy older than the tombstones never held, and trips deleted elsewhere came back).
  const at = !carry && last?.key === clean ? last.at : undefined;
  await set(KEY, { key: clean, v: 0, stamps, ...(at ? { at } : {}) } satisfies Saved);
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
  if (saved)
    await set(LAST, {
      key: saved.key,
      stamps: saved.stamps,
      ...(saved.at ? { at: saved.at } : {}),
    });
  log('sync.stop');
  await del(KEY);
  useSync.setState({ key: null, status: 'off', at: null, settled: true });
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
    // 410: closed already (a retry after the first answer was lost): renewed all the same.
    if (!res?.ok && res?.status !== 410) {
      useSync.setState({ status: res ? problemOf(res.status) : 'offline' });
      return false;
    }
  }
  await startSync(undefined, saved?.stamps);
  return true;
}

const MINUTE = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Syncs on start, back in view, every minute in view, and 3 s after the last change. */
export function watchSync() {
  // Retiring waits for the first round that reaches the server (`settled`), so a trip moved to
  // a later day on another device is seen first; without sync it may run at once.
  void loadSync()
    .then(() => {
      if (!useSync.getState().key || !syncAvailable()) useSync.setState({ settled: true });
      return syncNow();
    })
    .catch(() => undefined);
  const later = () => {
    if (!useSync.getState().key) return;
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 3000);
  };
  const a = useTours.subscribe((s, p) => s.tours !== p.tours && later());
  const b = useTrips.subscribe((s, p) => s.trips !== p.trips && later());
  const c = useRecentStops.subscribe((s, p) => s.stops !== p.stops && later());
  const visible = () => document.visibilityState === 'visible' && void syncNow();
  document.addEventListener('visibilitychange', visible);
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible' && useSync.getState().key) void syncNow();
  }, MINUTE);
  return () => {
    a();
    b();
    c();
    clearTimeout(timer);
    clearInterval(tick);
    document.removeEventListener('visibilitychange', visible);
  };
}
