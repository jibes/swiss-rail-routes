import { describe, expect, it, vi } from 'vitest';
import { handle, type Deps } from '../workers/ojp/src/handler';
import { MAX_DATA, syncHandle, type SyncRecord } from '../workers/ojp/src/sync';

const ORIGIN = 'https://jibes.github.io';
const body = {
  origin: { ref: '8503000', name: 'Zürich HB' },
  destination: { ref: '8509000', name: 'Chur' },
  time: '2026-11-07T08:00',
};

const syncBoxes = new Map<string, SyncRecord>();

function setup(over: Partial<Deps> = {}) {
  const store = new Map<string, string>();
  const pending: Promise<unknown>[] = [];
  const upstream = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response('<OJP/>'),
  );
  const deps: Deps = {
    apiKey: 'secret-key',
    upstream: 'https://api.example/ojp20',
    allowedOrigins: [ORIGIN],
    fetch: upstream as unknown as typeof fetch,
    cache: {
      match: async (k) => (store.has(k.url) ? new Response(store.get(k.url)) : undefined),
      put: async (k, r) => void store.set(k.url, await r.text()),
    },
    limit: async () => true,
    now: () => new Date('2026-11-01T12:00:00Z'),
    defer: (p) => void pending.push(p),
    sync: async (id, req) => {
      const boxes = syncBoxes;
      return syncHandle(req, {
        get: async () => boxes.get(id),
        put: async (r) => void boxes.set(id, r),
        delete: async () => void boxes.delete(id),
      });
    },
    ...over,
  };
  const call = (path = '/trip', init: RequestInit = {}) =>
    handle(
      new Request(`https://w.example${path}`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...init,
      }),
      deps,
    );
  return { call, upstream, flush: () => Promise.all(pending) };
}

describe('OJP worker', () => {
  it('builds the XML itself and sends the key only upstream', async () => {
    const { call, upstream } = setup();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await res.text()).toBe('<OJP/>');
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe('https://api.example/ojp20');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    expect(String(init!.body)).toContain('<OJPTripRequest>');
    expect([...res.headers.values()].join()).not.toContain('secret-key');
  });

  it('serves repeats from the cache without asking upstream or the limiter', async () => {
    const limit = vi.fn(async () => true);
    const { call, upstream, flush } = setup({ limit });
    await call();
    await flush();
    const second = await call();
    expect(second.headers.get('X-Cache')).toBe('hit');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign origins, bad paths, bad bodies, other methods', async () => {
    const { call, upstream } = setup();
    expect((await call('/trip', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('/raw')).status).toBe(404);
    expect((await call('/trip', { body: '{"origin":1}' })).status).toBe(400);
    expect((await call('/trip', { body: 'not json' })).status).toBe(400);
    expect((await call('/trip', { method: 'GET', body: null })).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers preflight', async () => {
    const { call } = setup();
    const res = await call('/trip', { method: 'OPTIONS', body: null });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE');
  });

  it('rate-limits misses with 429', async () => {
    const { call, upstream } = setup({ limit: async () => false });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('maps upstream failures and does not cache them', async () => {
    const failing = vi.fn(async () => new Response('quota', { status: 429 }));
    const { call, flush } = setup({ fetch: failing as unknown as typeof fetch });
    expect((await call()).status).toBe(503);
    await flush();
    expect((await call()).status).toBe(503);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('handles stop search', async () => {
    const { call, upstream } = setup();
    const res = await call('/stops', { body: JSON.stringify({ text: 'Mürren' }) });
    expect(res.status).toBe(200);
    expect(String(upstream.mock.calls[0]![1]!.body)).toContain('<OJPLocationInformationRequest>');
  });

  it('says what is wrong, readable by the app', async () => {
    const { call } = setup({ apiKey: '' });
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await res.text()).toContain('OJP_API_KEY');
    const broken = setup({
      limit: async () => {
        throw new Error('binding');
      },
    });
    const r2 = await broken.call();
    expect(r2.status).toBe(500);
    expect(r2.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('answers live journey calls, cached briefly', async () => {
    const { call, upstream, flush } = setup();
    const body = JSON.stringify({ journey: 'ch:1:sjyid:100001:726-001', day: '2026-11-01' });
    const res = await call('/journey', { body });
    expect(res.status).toBe(200);
    expect(String(upstream.mock.calls[0]![1]!.body)).toContain('<OJPTripInfoRequest>');
    await flush();
    expect((await call('/journey', { body })).headers.get('X-Cache')).toBe('hit');
    expect((await call('/journey', { body: '{"journey":"x"}' })).status).toBe(400);
  });
});

describe('sync mailbox', () => {
  const ID = 'a'.repeat(43);
  const sync = (method: string, body?: unknown, id = ID) =>
    setup().call(`/sync/${id}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('stores one blob per id, version by version, and refuses a stale write', async () => {
    syncBoxes.clear();
    expect((await sync('GET')).status).toBe(404);
    const first = await sync('PUT', { v: 0, data: 'abc' });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ v: 1 });
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    // Another device that read nothing must merge first: it gets what is there.
    const stale = await sync('PUT', { v: 0, data: 'other' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ v: 1, data: 'abc' });
    expect((await sync('PUT', { v: 1, data: 'def' })).status).toBe(200);
    expect(await (await sync('GET')).json()).toEqual({ v: 2, data: 'def' });
    expect((await sync('DELETE')).status).toBe(204);
    expect((await sync('GET')).status).toBe(404);
  });

  it('rejects odd ids, shapes and sizes', async () => {
    expect((await sync('GET', undefined, 'short')).status).toBe(404);
    expect((await sync('PUT', { v: -1, data: 'x' })).status).toBe(400);
    expect((await sync('PUT', { v: 0, data: 'not base64url!' })).status).toBe(400);
    expect((await sync('PUT', { v: 0, data: 'x'.repeat(MAX_DATA + 1) })).status).toBe(413);
  });

  it('answers the preflight for PUT', async () => {
    const res = await setup().call(`/sync/${ID}`, { method: 'OPTIONS', body: undefined });
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });
});
