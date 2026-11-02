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
  /** Reading failed: nothing is written for the rest of this visit. */
  failed: () => boolean;
}

export function savedList<T extends Item>(key: string, read: (raw: unknown) => T[]): SavedList<T> {
  let pending = new Map<string, T | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let broken = false;
  let listener: ((list: T[]) => void) | undefined;
  let writing: Promise<void> = Promise.resolve();
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`srr-list:${key}`);

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (broken || !pending.size) return writing;
    const changes = pending;
    pending = new Map();
    writing = writing
      .then(() => update<unknown>(key, (stored) => applyChanges(read(stored), changes)))
      .then(() => channel?.postMessage('saved'))
      .catch((e: unknown) => log('store.save.fail', { key, e }));
    return writing;
  };

  channel?.addEventListener('message', () => {
    void get(key)
      .then((raw) => listener?.(applyChanges(read(raw), pending)))
      .catch((e: unknown) => log('store.reload.fail', { key, e }));
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  }

  return {
    load: async () => {
      try {
        return read(await get(key));
      } catch (e) {
        broken = true;
        log('store.load.fail', { key, e });
        throw e;
      }
    },
    save: (before, after, now = false) => {
      for (const [id, x] of changesOf(before, after)) pending.set(id, x);
      if (now) return flush();
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 300);
      return Promise.resolve();
    },
    onOtherTab: (cb) => {
      listener = cb;
    },
    failed: () => broken,
  };
}
