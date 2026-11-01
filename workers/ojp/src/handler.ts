// OJP proxy: typed JSON in, OJP XML out. Holds the key, caches 10 min, limits per client IP.
// Standard Fetch API only, so tests run it in Node with fakes.
import {
  cacheKeyOf,
  parseStopQuery,
  parseTripQuery,
  stopRequestXml,
  tripRequestXml,
} from '../../../src/core/ojp/request';

export interface Deps {
  apiKey: string;
  upstream: string;
  allowedOrigins: string[];
  fetch: typeof fetch;
  cache: {
    match(key: Request): Promise<Response | undefined>;
    put(key: Request, res: Response): Promise<void>;
  };
  limit: (key: string) => Promise<boolean>;
  now: () => Date;
  /** Keeps the cache write alive after the response is sent (ctx.waitUntil). */
  defer: (p: Promise<unknown>) => void;
}

export const CACHE_SECONDS = 600;
const REQUESTOR = 'swiss-rail-routes';

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** Every answer, errors included, carries CORS headers so the app can read why it failed. */
export async function handle(req: Request, d: Deps): Promise<Response> {
  try {
    return await route(req, d);
  } catch (e) {
    const h = cors(req.headers.get('Origin'), d.allowedOrigins);
    return new Response(`internal ${e instanceof Error ? e.name : 'error'}`, {
      status: 500,
      headers: { ...h, 'Content-Type': 'text/plain' },
    });
  }
}

async function route(req: Request, d: Deps): Promise<Response> {
  const origin = req.headers.get('Origin');
  const h = cors(origin, d.allowedOrigins);
  const reply = (status: number, body: string, extra: Record<string, string> = {}) =>
    new Response(body, { status, headers: { ...h, 'Content-Type': 'text/plain', ...extra } });

  if (origin && !h['Access-Control-Allow-Origin']) return reply(403, 'origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return reply(405, 'method');
  if (!d.apiKey) return reply(503, 'not configured: OJP_API_KEY');

  const path = new URL(req.url).pathname;
  if (path !== '/trip' && path !== '/stops') return reply(404, 'path');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, 'json');
  }
  const kind = path === '/trip' ? 'trip' : 'stops';
  const q = kind === 'trip' ? parseTripQuery(body) : parseStopQuery(body);
  if (typeof q === 'string') return reply(400, q);

  const cacheReq = new Request(`https://cache.invalid/${await sha256(cacheKeyOf(kind, q))}`);
  const hit = await d.cache.match(cacheReq);
  if (hit) {
    return new Response(hit.body, {
      status: 200,
      headers: { ...h, 'Content-Type': 'application/xml', 'X-Cache': 'hit' },
    });
  }

  if (!(await d.limit(req.headers.get('CF-Connecting-IP') ?? 'unknown')))
    return reply(429, 'rate', { 'Retry-After': '60' });

  const xml =
    kind === 'trip'
      ? tripRequestXml(q as Parameters<typeof tripRequestXml>[0], d.now(), REQUESTOR)
      : stopRequestXml(q as Parameters<typeof stopRequestXml>[0], d.now(), REQUESTOR);

  let up: Response;
  try {
    up = await d.fetch(d.upstream, {
      method: 'POST',
      headers: { Authorization: `Bearer ${d.apiKey}`, 'Content-Type': 'application/xml' },
      body: xml,
    });
  } catch {
    return reply(502, 'upstream');
  }
  if (!up.ok) return reply(up.status === 429 ? 503 : 502, `upstream ${up.status}`);

  const text = await up.text();
  d.defer(
    d.cache.put(
      cacheReq,
      new Response(text, {
        headers: {
          'Content-Type': 'application/xml',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        },
      }),
    ),
  );
  return new Response(text, {
    status: 200,
    headers: { ...h, 'Content-Type': 'application/xml', 'X-Cache': 'miss' },
  });
}
