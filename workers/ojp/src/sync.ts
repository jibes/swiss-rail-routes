// Sync mailbox (SPEC §3b): one encrypted blob per sync id, nothing else. The Worker cannot read
// it: the key never leaves the devices. Writes are compare-and-swap on a version number, so two
// devices never overwrite each other unseen; the one that loses merges and tries again.
//
//   GET    /sync/<id>  → 200 {v, data} | 404
//   PUT    /sync/<id>  {v: version it read (0 for none), data} → 200 {v} | 409 {v, data}
//   DELETE /sync/<id>  → 204 (sync turned off everywhere, or a new key)

export interface SyncRecord {
  v: number;
  data: string;
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
  if (req.method === 'GET') {
    const r = await store.get();
    return r ? json(200, r) : json(404, { v: 0 });
  }
  if (req.method === 'DELETE') {
    await store.delete();
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'PUT') return json(405, { error: 'method' });
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
  if ((cur?.v ?? 0) !== v) return json(409, cur ?? { v: 0 });
  const next = { v: (v as number) + 1, data };
  await store.put(next);
  return json(200, { v: next.v });
}
