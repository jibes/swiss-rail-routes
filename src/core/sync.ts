// Sync between one's own devices without an account (SPEC §3b), like Brave Sync: a random key,
// shown as text and QR code, is the only thing that links them. From it each device derives
// where the data lives on the Worker (`id`) and how it is encrypted (AES-GCM); the Worker only
// ever sees the id and ciphertext. Routes and trips merge item by item: the newer change wins,
// deletions travel as tombstones for 90 days.
//
// Pure apart from WebCrypto and CompressionStream (both in browsers and Node).

export interface Stamp {
  /** Hash of the item's JSON; '' once deleted. */
  h: string;
  /** When this device (or the one it came from) last saw it change, ms. */
  at: number;
}
export type Stamps = Record<string, Stamp>;

/** One item in the shared document; no `value` means deleted. */
export interface Entry<T> {
  id: string;
  at: number;
  value?: T;
}

export interface SyncDoc<R, T> {
  v: 1;
  tours: Entry<R>[];
  trips: Entry<T>[];
}

export const TOMBSTONE_DAYS = 90;
const DAY = 86_400_000;

// ── The key ─────────────────────────────────────────────────────────────────────────────────

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

/** 32 random bytes as 52 Crockford base32 characters in groups of four. */
export function formatKey(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** Reads a key as typed: any case, spaces or dashes, O for 0 and I or L for 1. */
export function parseKey(text: string): Uint8Array<ArrayBuffer> | null {
  const s = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 52 || [...s].some((c) => !B32.includes(c))) return null;
  const out = new Uint8Array(32);
  let bits = 0;
  let acc = 0;
  let i = 0;
  for (const c of s) {
    acc = (acc << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      if (i < 32) out[i++] = (acc >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

export const newKey = () => formatKey(crypto.getRandomValues(new Uint8Array(32)));

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

/** Where the data lives (43 characters) and the key that encrypts it, both from the sync key. */
export async function deriveKeys(
  key: Uint8Array<ArrayBuffer>,
): Promise<{ id: string; aes: CryptoKey }> {
  const base = await crypto.subtle.importKey('raw', key, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const params = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('srr-sync-v1'),
    info: new TextEncoder().encode(info),
  });
  const id = new Uint8Array(await crypto.subtle.deriveBits(params('id'), base, 256));
  const aes = await crypto.subtle.deriveKey(
    params('aes'),
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { id: b64url(id), aes };
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** JSON, deflated, AES-GCM with a fresh 12-byte IV; base64url of IV and ciphertext. */
export async function seal(doc: unknown, aes: CryptoKey): Promise<string> {
  const plain = await pipe(
    new TextEncoder().encode(JSON.stringify(doc)),
    new CompressionStream('deflate-raw'),
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain));
  const all = new Uint8Array(12 + ct.length);
  all.set(iv);
  all.set(ct, 12);
  return b64url(all);
}

/** The document back; throws if the key is wrong or the data was changed. */
export async function open<T>(data: string, aes: CryptoKey): Promise<T> {
  const all = fromB64url(data);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: all.slice(0, 12) },
    aes,
    all.slice(12),
  );
  const json = await pipe(new Uint8Array(plain), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(json)) as T;
}

// ── Changes and merging ─────────────────────────────────────────────────────────────────────

/** FNV-1a over the JSON: enough to notice a change, not a security property. */
export function hashOf(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}

/**
 * This device's items as entries: unchanged ones keep their time, changed or new ones get a
 * time after both now and their last one (a device whose clock runs behind still wins with
 * its own newer edit), and ones gone since the last sync become tombstones.
 */
export function stampLocal<T extends { id: string }>(
  prev: Stamps,
  items: T[],
  now: number,
): Entry<T>[] {
  const seen = new Set<string>();
  const later = (p?: Stamp) => Math.max(now, (p?.at ?? 0) + 1);
  const out: Entry<T>[] = items.map((value) => {
    seen.add(value.id);
    const p = prev[value.id];
    return { id: value.id, at: p && p.h === hashOf(value) ? p.at : later(p), value };
  });
  for (const [id, p] of Object.entries(prev))
    if (!seen.has(id)) out.push({ id, at: p.h === '' ? p.at : later(p) });
  return out;
}

const keyOf = <T>(e: Entry<T>) => `${e.id}|${e.at}|${e.value ? hashOf(e.value) : ''}`;

/**
 * Per item the newer entry wins; on a tie the deletion, then the larger hash, so every device
 * picks the same one. Tombstones older than TOMBSTONE_DAYS go.
 */
export function mergeEntries<T>(a: Entry<T>[], b: Entry<T>[], now: number): Entry<T>[] {
  const by = new Map<string, Entry<T>>();
  for (const e of [...a, ...b]) {
    const o = by.get(e.id);
    if (!o || e.at > o.at || (e.at === o.at && keyOf(e) !== keyOf(o) && tieWins(e, o)))
      by.set(e.id, e);
  }
  return [...by.values()].filter((e) => e.value || now - e.at < TOMBSTONE_DAYS * DAY);
}

const tieWins = <T>(e: Entry<T>, o: Entry<T>) =>
  !e.value ? true : !o.value ? false : hashOf(e.value) > hashOf(o.value);

export const stampsOf = <T>(entries: Entry<T>[]): Stamps =>
  Object.fromEntries(entries.map((e) => [e.id, { h: e.value ? hashOf(e.value) : '', at: e.at }]));

/** Stamps for a device joining: what it has counts as older than anything shared. */
export const joinStamps = <T extends { id: string }>(items: T[]): Stamps =>
  Object.fromEntries(items.map((v) => [v.id, { h: hashOf(v), at: 0 }]));

/** The items to keep: new ones first, then this device's order. */
export function itemsOf<T extends { id: string }>(entries: Entry<T>[], order: T[]): T[] {
  const live = new Map(entries.filter((e) => e.value).map((e) => [e.id, e.value!]));
  const known = order.filter((x) => live.has(x.id)).map((x) => live.get(x.id)!);
  const fresh = [...live.values()].filter((x) => !order.some((o) => o.id === x.id));
  return [...fresh, ...known];
}

/** True when two sets of entries hold the same items, values and times. */
export function sameEntries<T>(a: Entry<T>[], b: Entry<T>[]): boolean {
  if (a.length !== b.length) return false;
  const x = a.map(keyOf).sort();
  const y = b.map(keyOf).sort();
  return x.every((k, i) => k === y[i]);
}

const sameList = <X extends { id: string }>(a: X[], b: X[]) =>
  a.length === b.length && a.every((x, i) => x === b[i] || hashOf(x) === hashOf(b[i]));

export interface Local<R, T> {
  tours: R[];
  trips: T[];
}

export interface RoundPlan<R, T> {
  merged: { tours: Entry<R>[]; trips: Entry<T>[] };
  /** New lists for this device, where they differ from what it has. */
  apply: Partial<Local<R, T>>;
  /** Whether the shared copy lacks something this device has. */
  push: boolean;
  stamps: { tours: Stamps; trips: Stamps };
}

/**
 * One sync round, decided without I/O: this device's lists against the shared document.
 * `lastSync`: when this device last synced; after longer than TOMBSTONE_DAYS the deletions it
 * missed may have expired, so items it did not change and the shared copy no longer has are
 * taken as deleted instead of being brought back.
 */
export function planRound<R extends { id: string }, T extends { id: string }>(input: {
  stamps: { tours: Stamps; trips: Stamps };
  local: Local<R, T>;
  remote: SyncDoc<R, T> | null;
  now: number;
  lastSync?: number;
}): RoundPlan<R, T> {
  const { stamps, local, remote, now, lastSync } = input;
  const stale = lastSync !== undefined && now - lastSync >= TOMBSTONE_DAYS * DAY;
  const side = <X extends { id: string }>(prev: Stamps, items: X[], theirs: Entry<X>[]) => {
    let mine = stampLocal(prev, items, now);
    if (stale && remote) {
      const there = new Set(theirs.map((e) => e.id));
      mine = mine.filter((e) => there.has(e.id) || !prev[e.id] || prev[e.id]!.at !== e.at);
    }
    const merged = mergeEntries(mine, theirs, now);
    return { mine, merged };
  };
  const t = side(stamps.tours, local.tours, remote?.tours ?? []);
  const r = side(stamps.trips, local.trips, remote?.trips ?? []);
  const apply: Partial<Local<R, T>> = {};
  const nextTours = itemsOf(t.merged, local.tours);
  const nextTrips = itemsOf(r.merged, local.trips);
  if (!sameList(nextTours, local.tours)) apply.tours = nextTours;
  if (!sameList(nextTrips, local.trips)) apply.trips = nextTrips;
  const push =
    !remote ||
    !sameEntries(t.merged, remote.tours ?? []) ||
    !sameEntries(r.merged, remote.trips ?? []);
  return {
    merged: { tours: t.merged, trips: r.merged },
    apply,
    push,
    stamps: { tours: stampsOf(t.merged), trips: stampsOf(r.merged) },
  };
}

/** The key from a scanned code: the app's `#/sync/<key>` link, or a bare key. */
export function keyFromScan(text: string): string | null {
  const link = /#\/sync\/([^?#\s]+)/.exec(text);
  const bytes = parseKey(link ? decodeURIComponent(link[1]!) : text.trim());
  return bytes ? formatKey(bytes) : null;
}
