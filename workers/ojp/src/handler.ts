// OJP proxy: typed JSON in, OJP XML out. Holds the key, limits per client IP.
// POST /trip and /stops (cached 10 min), POST /journey (live calls of one train, cached 30 s),
// GET/PUT/DELETE /sync/<id> (an encrypted blob per sync id, see sync.ts).
// Standard Fetch API only, so tests run it in Node with fakes.
import {
  cacheKeyOf,
  journeyRequestXml,
  parseJourneyQuery,
  parseStopQuery,
  parseTripQuery,
  stopRequestXml,
  tripRequestXml,
} from '../../../src/core/ojp/request';
import { SYNC_ID } from './sync';

/** Request kinds: how to validate, how to build the OJP XML, how long to cache. */
const KINDS = {
  trip: { parse: parseTripQuery, xml: tripRequestXml, cache: 600 },
  stops: { parse: parseStopQuery, xml: stopRequestXml, cache: 600 },
  // Live calls of one vehicle: real time, so only briefly cached.
  journey: { parse: parseJourneyQuery, xml: journeyRequestXml, cache: 30 },
} as const;
type Kind = keyof typeof KINDS;

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
  /** Passes a sync request to the storage of its id (a Durable Object in production). */
  sync: (id: string, req: Request) => Promise<Response>;
}

const REQUESTOR = 'swiss-rail-routes';

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    // The app logs whether an answer came from the cache (debug log).
    'Access-Control-Expose-Headers': 'X-Cache',
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

  const path = new URL(req.url).pathname;
  if (path.startsWith('/sync/')) {
    const id = path.slice(6);
    if (!SYNC_ID.test(id)) return reply(404, 'sync id');
    if (!(await d.limit(`sync:${req.headers.get('CF-Connecting-IP') ?? 'unknown'}`)))
      return reply(429, 'rate', { 'Retry-After': '60' });
    const res = await d.sync(id, req);
    return new Response(res.body, {
      status: res.status,
      headers: { ...h, ...Object.fromEntries(res.headers) },
    });
  }

  if (req.method !== 'POST') return reply(405, 'method');
  if (!d.apiKey) return reply(503, 'not configured: OJP_API_KEY');

  const kind = path.slice(1) as Kind;
  if (!Object.hasOwn(KINDS, kind)) return reply(404, 'path');
  const spec = KINDS[kind];

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, 'json');
  }
  const q = spec.parse(body);
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

  const xml = (spec.xml as (q: unknown, now: Date, r: string) => string)(q, d.now(), REQUESTOR);

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
  // An error OJP answers with 200 (a passing upstream problem) is not kept for everyone for
  // ten minutes; "no trip found" is an answer and is kept.
  const failed = /<(?:\w+:)?ErrorCondition>/.test(text) && !/NOTRIPFOUND/.test(text);
  if (!failed)
    d.defer(
      d.cache.put(
        cacheReq,
        new Response(text, {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': `public, max-age=${spec.cache}`,
          },
        }),
      ),
    );
  return new Response(text, {
    status: 200,
    headers: { ...h, 'Content-Type': 'application/xml', 'X-Cache': 'miss' },
  });
}
