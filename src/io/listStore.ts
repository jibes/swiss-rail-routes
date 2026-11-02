// One saved list (trips, past trips) in IndexedDB, shared by every tab of the app. Changes are
// saved item by item into what is stored now (one IndexedDB transaction), never as the whole
// list a tab holds: a stale tab cannot overwrite what another tab saved. Each save tells the
// other tabs, which read the list again. A list that could not be read is never written.
import { get, update } from 'idb-keyval';
import { log } from './log';

interface Item {
  id: string;
}

/** What changed between two versions of the list: id → the new item, or null when removed. */
export function changesOf<T extends Item>(before: T[], after: T[]): Map<string, T | null> {
  const out = new Map<string, T | null>();
  const old = new Map(before.map((x) => [x.id, x]));
  for (const x of after) if (old.get(x.id) !== x) out.set(x.id, x);
  const now = new Set(after.map((x) => x.id));
  for (const x of before) if (!now.has(x.id)) out.set(x.id, null);
  return out;
}

/** `changes` applied to `stored`: changed items in place, new ones first, removed ones gone. */
export function applyChanges<T extends Item>(stored: T[], changes: Map<string, T | null>): T[] {
  const seen = new Set<string>();
  const kept = stored.flatMap((x) => {
    seen.add(x.id);
    if (!changes.has(x.id)) return [x];
    const c = changes.get(x.id);
    return c ? [c] : [];
  });
  const added = [...changes.values()].filter((x): x is T => !!x && !seen.has(x.id));
  return [...added, ...kept];
}

export interface SavedList<T extends Item> {
  /** The stored list; throws when storage cannot be read. */
  load: () => Promise<T[]>;
  /** Records the change from `before` to `after`; saved after 300 ms, or at once. */
  save: (before: T[], after: T[], now?: boolean) => Promise<void>;
  /** Called with the stored list (with this tab's unsaved changes) when another tab saved. */
  onOtherTab: (cb: (list: T[]) => void) => void;
  /** Reading or writing failed: nothing more is written (or synced) this visit. */
  failed: () => boolean;
  /** Called once when it fails (the store shows it, sync stops). */
  onFailed: (cb: () => void) => void;
}

export function savedList<T extends Item>(key: string, read: (raw: unknown) => T[]): SavedList<T> {
  let pending = new Map<string, T | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let broken = false;
  let listener: ((list: T[]) => void) | undefined;
  let failedCb: (() => void) | undefined;
  let writing: Promise<void> = Promise.resolve();
  const fail = () => {
    if (broken) return;
    broken = true;
    failedCb?.();
  };
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`srr-list:${key}`);

  /**
   * Writes what is pending. A failed write rejects (a sync round must not count it as saved:
   * what it received would look deleted after a reload), keeps the changes in memory, and
   * marks the list failed: nothing more is written or synced this visit.
   */
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (broken) return Promise.reject(new Error(`${key}: storage failed`));
    if (!pending.size) return writing;
    const changes = pending;
    pending = new Map();
    const done = writing
      .then(() => update<unknown>(key, (stored) => applyChanges(read(stored), changes)))
      .then(() => void channel?.postMessage('saved'));
    // The chain goes on after a failure; this write's caller hears of it.
    writing = done.catch((e: unknown) => {
      log('store.save.fail', { key, e });
      for (const [id, x] of changes) if (!pending.has(id)) pending.set(id, x);
      fail();
    });
    return done;
  };

  channel?.addEventListener('message', () => {
    // After this tab's own writes in flight (IndexedDB keeps their order): the reload sees
    // them, and an edit just taken out of `pending` is not lost from memory.
    void writing
      .then(() => get(key))
      .then((raw) => listener?.(applyChanges(read(raw), pending)))
      .catch((e: unknown) => log('store.reload.fail', { key, e }));
  });
  const quiet = () => void flush().catch(() => undefined);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', quiet);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') quiet();
    });
  }

  return {
    load: async () => {
      try {
        return read(await get(key));
      } catch (e) {
        log('store.load.fail', { key, e });
        fail();
        throw e;
      }
    },
    save: (before, after, now = false) => {
      for (const [id, x] of changesOf(before, after)) pending.set(id, x);
      if (now) return flush();
      clearTimeout(timer);
      timer = setTimeout(quiet, 300);
      return Promise.resolve();
    },
    onOtherTab: (cb) => {
      listener = cb;
    },
    failed: () => broken,
    onFailed: (cb) => {
      failedCb = cb;
    },
  };
}
