// Sync mailbox (SPEC §3b): one encrypted blob per sync id, nothing else. The Worker cannot read
// it: the key never leaves the devices. Writes are compare-and-swap on a version number, so two
// devices never overwrite each other unseen; the one that loses merges and tries again.
//
//   GET    /sync/<id>[?v=N] → 200 {v, data}; {v, same: true} when N is current; {v: 0} while empty (not 404: browsers log
//                         every 404 as an error, and an empty mailbox is normal)
//   PUT    /sync/<id>  {v: version it read (0 for none), data} → 200 {v} | 409 {v, data}
//   DELETE /sync/<id>  → 204 (a new key): the blob goes, a marker stays, and from then on
//                         GET and PUT answer 410, so devices still on that key stop and say so
//                         instead of filling it again; a box never written stays nothing.
//                         Unused boxes expire (SyncBox alarm).

export interface SyncRecord {
  v: number;
  data: string;
  /** Closed by a new key. */
  revoked?: boolean;
}

/** Storage for one id: a Durable Object's own storage in production, a Map in tests. */
export interface SyncStore {
  get(): Promise<SyncRecord | undefined>;
  put(r: SyncRecord): Promise<void>;
  /** A device read it: the box is in use, so it does not expire. */
  touch?(): Promise<void>;
}

/** A sync id: 32 bytes base64url, derived from the key (HKDF), never the key itself. */
export const SYNC_ID = /^[\w-]{43}$/;
/** About 750 KB of ciphertext: hundreds of trips with their timetables. */
export const MAX_DATA = 1_000_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function syncHandle(req: Request, store: SyncStore): Promise<Response> {
  // A write's body is read before the record: reading a body lets other requests in (Durable
  // Object input gates cover storage only), so the version check and the write must follow
  // the read of the record with nothing awaited in between.
  if (req.method === 'PUT') return write(req, store);
  const cur = await store.get();
  if (cur?.revoked) return json(410, { revoked: true });
  if (req.method === 'GET') {
    if (cur) await store.touch?.();
    // The version the device already has: no data (devices check every minute).
    const known = Number(new URL(req.url).searchParams.get('v'));
    if (cur && known && known === cur.v) return json(200, { v: cur.v, same: true });
    return json(200, cur ?? { v: 0 });
  }
  if (req.method === 'DELETE') {
    // A box that never was is not made now: a marker for every id anyone names would be
    // storage without end.
    if (cur) await store.put({ v: cur.v + 1, data: '', revoked: true });
    return new Response(null, { status: 204 });
  }
  return json(405, { error: 'method' });
}

async function write(req: Request, store: SyncStore): Promise<Response> {
  // Refuse a body too large before reading it.
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_DATA + 100)
    return json(413, { error: 'size' });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'json' });
  }
  const { v, data } = (body ?? {}) as Partial<SyncRecord>;
  if (!Number.isInteger(v) || (v as number) < 0 || typeof data !== 'string')
    return json(400, { error: 'shape' });
  if (data.length > MAX_DATA) return json(413, { error: 'size' });
  if (!/^[\w-]+$/.test(data)) return json(400, { error: 'data' });
  const cur = await store.get();
  if (cur?.revoked) return json(410, { revoked: true });
  if ((cur?.v ?? 0) !== v) return json(409, cur ?? { v: 0 });
  const next = { v: (v as number) + 1, data };
  await store.put(next);
  return json(200, { v: next.v });
}
