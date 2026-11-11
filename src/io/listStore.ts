// One saved list (trips, past trips) in IndexedDB, shared by every tab of the app. Changes are
// saved item by item into what is stored now (one IndexedDB transaction), never as the whole
// list a tab holds: a stale tab cannot overwrite what another tab saved. Each save tells the
// other tabs, which read the list again. A list that could not be read is never written.
// IndexedDB cannot finish a write once the page goes (it must read before it writes), so what is
// still unsaved then goes to localStorage, written at once, and into the list on the next load.
// An item this version cannot read (a newer version's, synced in) is held as it came: never
// shown, written back untouched, and given to sync as it is, so it is neither lost nor deleted.
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

/** The stored items `read` could not read (an object with an id), as they came. */
export function heldOf(stored: unknown, items: Item[]): Item[] {
  if (!Array.isArray(stored)) return [];
  const known = new Set(items.map((x) => x.id));
  return stored.filter(
    (x): x is Item =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as Item).id === 'string' &&
      !known.has((x as Item).id),
  );
}

/** What was left unsaved, from its stored form; nothing when it is unreadable. */
export function readUnsaved<T extends Item>(raw: string | null): Map<string, T | null> {
  try {
    const entries: unknown = JSON.parse(raw ?? '[]');
    return new Map(Array.isArray(entries) ? (entries as [string, T | null][]) : []);
  } catch {
    return new Map();
  }
}

/**
 * What a page left unsaved, less the changes now known to be stored: an entry goes when it is
 * the very change written (by its value: another tab's newer edit of the same item stays).
 * Without this, an edit of a closing tab whose write did finish after all would come back on
 * the next load as a new edit, outranking anything done to the item meanwhile.
 */
export function settleUnsaved<T extends Item>(
  raw: string | null,
  written: Map<string, T | null>,
): string | null {
  const left = readUnsaved<T>(raw);
  if (!left.size) return raw;
  for (const [id, x] of written)
    if (left.has(id) && JSON.stringify(left.get(id)) === JSON.stringify(x)) left.delete(id);
  return left.size ? JSON.stringify([...left]) : null;
}

/** localStorage, if this visit has it (the accessor throws with site data blocked). */
function unsavedStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export interface SavedList<T extends Item> {
  /** The stored list; throws when storage cannot be read. */
  load: () => Promise<T[]>;
  /** Records the change from `before` to `after`; saved after 300 ms, or at once. */
  save: (before: T[], after: T[], now?: boolean) => Promise<void>;
  /** The items held as they came (unreadable here), for sync. */
  held: () => Item[];
  /**
   * The whole list as sync merged it, from `before` (what the screens hold): saved at once.
   * Returns what the screens may hold; the rest is held.
   */
  replace: (before: T[], all: Item[]) => { items: T[]; saved: Promise<void> };
  /** Called with the stored list (with this tab's unsaved changes) when another tab saved. */
  onOtherTab: (cb: (list: T[]) => void) => void;
  /** Reading or writing failed: nothing more is written (or synced) this visit. */
  failed: () => boolean;
  /** Called once when it fails (the store shows it, sync stops). */
  onFailed: (cb: () => void) => void;
}

export function savedList<T extends Item>(key: string, read: (raw: unknown) => T[]): SavedList<T> {
  let pending = new Map<string, T | null>();
  /** Taken out of `pending`, not yet known to be stored. */
  const writes = new Map<string, T | null>();
  const unsavedKey = key.replace('srr.', 'srr.unsaved.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let broken = false;
  let listener: ((list: T[]) => void) | undefined;
  let failedCb: (() => void) | undefined;
  let writing: Promise<void> = Promise.resolve();
  let held: Item[] = [];
  /** What is stored, read: what can be shown, and what is held (`held` kept up to date). */
  const readStored = (stored: unknown) => {
    const items = read(stored);
    held = heldOf(stored, items);
    return items;
  };
  /** `changes` applied to what is stored, the held items written back as they came. */
  const write = (stored: unknown, changes: Map<string, T | null>) => {
    const items = applyChanges(read(stored), changes);
    const kept = heldOf(stored, items).filter((x) => !changes.has(x.id));
    return [...items, ...kept];
  };
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
    for (const [id, x] of changes) writes.set(id, x);
    const done = writing
      .then(() => update<unknown>(key, (stored) => write(stored, changes)))
      .then(() => get(key))
      .then((stored) => {
        readStored(stored);
        for (const [id, x] of changes) if (writes.get(id) === x) writes.delete(id);
        settle(changes);
        channel?.postMessage('saved');
      });
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
      // This tab's edits not known stored yet, in flight too (reported in review: an edit
      // begun meanwhile was reverted in memory, then overwritten by the next one).
      .then((raw) => listener?.(applyChanges(readStored(raw), new Map([...writes, ...pending]))))
      .catch((e: unknown) => log('store.reload.fail', { key, e }));
  });
  const quiet = () => void flush().catch(() => undefined);
  /** The page goes: what is not stored yet, added to what another tab closing just left. */
  const leave = () => {
    if (broken || (!pending.size && !writes.size)) return;
    try {
      const left = readUnsaved<T>(localStorage.getItem(unsavedKey));
      for (const [id, x] of [...writes, ...pending]) left.set(id, x);
      localStorage.setItem(unsavedKey, JSON.stringify([...left]));
      log('store.unsaved.leave', { key, items: left.size });
    } catch (e) {
      log('store.unsaved.fail', { key, e });
    }
  };
  /** A write that finished after the page was told to leave: not unsaved after all. */
  const settle = (changes: Map<string, T | null>) => {
    try {
      const storage = unsavedStorage();
      const raw = storage?.getItem(unsavedKey) ?? null;
      if (!storage || raw === null) return;
      const next = settleUnsaved(raw, changes);
      if (next === null) storage.removeItem(unsavedKey);
      else if (next !== raw) storage.setItem(unsavedKey, next);
    } catch (e) {
      log('store.unsaved.fail', { key, e });
    }
  };
  /** What a page left behind goes into the list, once it is stored. */
  const takeUnsaved = async () => {
    const left = readUnsaved<T>(unsavedStorage()?.getItem(unsavedKey) ?? null);
    if (!left.size) return;
    log('store.unsaved.take', { key, items: left.size });
    await update<unknown>(key, (stored) => write(stored, left));
    channel?.postMessage('saved');
    unsavedStorage()?.removeItem(unsavedKey);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      leave();
      quiet();
    });
    // Back from the browser's page cache, the page itself finishes its writes.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) unsavedStorage()?.removeItem(unsavedKey);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') quiet();
    });
  }

  return {
    load: async () => {
      try {
        await takeUnsaved();
        return readStored(await get(key));
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
    held: () => held,
    replace: (before, all) => {
      // What can be shown is shown as sync gave it (read only says which).
      const shown = new Set(read(all).map((x) => x.id));
      const items = all.filter((x) => shown.has(x.id)) as T[];
      const next = all.filter((x) => !shown.has(x.id));
      for (const [id, x] of changesOf(before, items)) pending.set(id, x);
      // Held items: a new or changed one is written as it came, one gone is removed.
      const was = new Map(held.map((x) => [x.id, JSON.stringify(x)]));
      for (const x of next) if (was.get(x.id) !== JSON.stringify(x)) pending.set(x.id, x as T);
      const now = new Set(all.map((x) => x.id));
      for (const x of held) if (!now.has(x.id)) pending.set(x.id, null);
      held = next;
      return { items, saved: flush() };
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
