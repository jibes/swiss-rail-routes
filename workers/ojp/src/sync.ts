// Sync mailbox (SPEC §3b): one encrypted blob per sync id, nothing else. The Worker cannot read
// it: the key never leaves the devices. Writes are compare-and-swap on a version number, so two
// devices never overwrite each other unseen; the one that loses merges and tries again.
//
//   GET    /sync/<id>  → 200 {v, data}, or 200 {v: 0} while empty (not 404: browsers log
//                         every 404 as an error, and an empty mailbox is normal)
//   PUT    /sync/<id>  {v: version it read (0 for none), data} → 200 {v} | 409 {v, data}
//   DELETE /sync/<id>  → 204 (a new key): the blob goes, a marker stays, and from then on
//                         GET and PUT answer 410, so devices still on that key stop and say so
//                         instead of filling it again. Unused boxes expire (SyncBox alarm).

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
  delete(): Promise<void>;
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
  const cur = await store.get();
  if (cur?.revoked) return json(410, { revoked: true });
  if (req.method === 'GET') return json(200, cur ?? { v: 0 });
  if (req.method === 'DELETE') {
    await store.put({ v: (cur?.v ?? 0) + 1, data: '', revoked: true });
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'PUT') return json(405, { error: 'method' });
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
  if ((cur?.v ?? 0) !== v) return json(409, cur ?? { v: 0 });
  const next = { v: (v as number) + 1, data };
  await store.put(next);
  return json(200, { v: next.v });
}
