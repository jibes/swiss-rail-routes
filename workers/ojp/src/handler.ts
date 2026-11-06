// OJP proxy: typed JSON in, OJP XML out. Holds the key, limits per client IP.
// POST /trip and /stops (cached 10 min), POST /journey (live calls of one train, cached 30 s),
// GET/PUT/DELETE /sync/<id> (an encrypted blob per sync id, see sync.ts).
// Standard Fetch API only, so tests run it in Node with fakes.
import { parseWeatherQuery, weatherUrl } from '../../../src/core/weather';
import {
  cacheKeyOf,
  departuresRequestXml,
  journeyRequestXml,
  parseDeparturesQuery,
  parseJourneyQuery,
  parseStopQuery,
  parseTripQuery,
  stopRequestXml,
  tripRequestXml,
} from '../../../src/core/ojp/request';
import {
  fareRequestXml,
  fareTripRequestXml,
  parseFareQuery,
  pickTrip,
} from '../../../src/core/ojp/fareRequest';
import {
  euPlanUrl,
  euStations,
  euStopsUrl,
  parseEuPlanQuery,
  parseEuStopQuery,
} from '../../../src/core/eu/request';
import { SYNC_ID } from './sync';

/** Request kinds: how to validate, how to build the OJP XML, how long to cache. */
const KINDS = {
  trip: { parse: parseTripQuery, xml: tripRequestXml, cache: 600 },
  stops: { parse: parseStopQuery, xml: stopRequestXml, cache: 600 },
  // Live calls of one vehicle: real time, so only briefly cached.
  journey: { parse: parseJourneyQuery, xml: journeyRequestXml, cache: 30 },
  // A stop's trains and where each goes (the map planner): as a trip's answers.
  departures: { parse: parseDeparturesQuery, xml: departuresRequestXml, cache: 600 },
} as const;
type Kind = keyof typeof KINDS;

export interface Deps {
  apiKey: string;
  /** OJP Fare's own key (one per API) and address; without a key /fare answers 503. */
  fareKey?: string;
  fareUpstream?: string;
  /** Open-Meteo (weather, 0.37.0): asked by the Worker alone, rounded places and days. */
  weatherUpstream?: string;
  /** Transitous (Europe, 0.30.0): asked by the Worker alone, trains only. */
  transitous?: string;
  upstream: string;
  allowedOrigins: string[];
  fetch: typeof fetch;
  cache: {
    match(key: Request): Promise<Response | undefined>;
    put(key: Request, res: Response): Promise<void>;
  };
  limit: (key: string) => Promise<boolean>;
  /** Sync writes, far fewer allowed (a device writes a few times an hour): storage is not free. */
  limitWrite: (key: string) => Promise<boolean>;
  now: () => Date;
  /** Keeps the cache write alive after the response is sent (ctx.waitUntil). */
  defer: (p: Promise<unknown>) => void;
  /** Passes a sync request to the storage of its id (a Durable Object in production). */
  sync: (id: string, req: Request) => Promise<Response>;
}

const REQUESTOR = 'swiss-rail-routes';
/** OJP has this long to answer. */
const UPSTREAM_TIMEOUT_MS = 25_000;

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    // The app logs whether an answer came from the cache (debug log).
    'Access-Control-Expose-Headers': 'X-Cache, Retry-After',
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
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await d.limit(`sync:${ip}`))) return reply(429, 'rate', { 'Retry-After': '60' });
    // Its size said up front, so a body is never read without bounds.
    if (req.method === 'PUT' && !req.headers.get('Content-Length')) return reply(411, 'length');
    // Writes (a blob, or the marker a new key leaves) have their own, tighter limit.
    if (req.method === 'PUT' || req.method === 'DELETE')
      if (!(await d.limitWrite(`put:${ip}`))) return reply(429, 'rate', { 'Retry-After': '60' });
    const res = await d.sync(id, req);
    return new Response(res.body, {
      status: res.status,
      headers: { ...h, ...Object.fromEntries(res.headers) },
    });
  }

  if (req.method !== 'POST') return reply(405, 'method');
  if (!d.apiKey) return reply(503, 'not configured: OJP_API_KEY');

  if (path === '/fare') return fare(req, d, reply, h);
  if (path === '/eu/stops' || path === '/eu/plan') return europe(path, req, d, reply, h);
  if (path === '/weather') return weather(req, d, reply, h);

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

  // OJP not answering ends here, not at Cloudflare's own limit: the app gives up at 30 s and
  // asks again, and a call left open would still count against this client's budget.
  let up: Response;
  try {
    up = await d.fetch(d.upstream, {
      method: 'POST',
      headers: { Authorization: `Bearer ${d.apiKey}`, 'Content-Type': 'application/xml' },
      body: xml,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    return reply(timedOut ? 504 : 502, timedOut ? 'upstream timeout' : 'upstream');
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

/** Prices do not change by the minute: an answer is kept for six hours. */
const FARE_CACHE_S = 6 * 3600;

/**
 * POST /fare (0.30.0): a connection's price. The trip is asked of OJP here, and OJP's own Trip
 * whose trains are the app's goes to OJP Fare: nothing the app sends is passed on as XML.
 */
async function fare(
  req: Request,
  d: Deps,
  reply: (status: number, body: string, extra?: Record<string, string>) => Response,
  h: Record<string, string>,
): Promise<Response> {
  if (!d.fareKey || !d.fareUpstream) return reply(503, 'not configured: OJP_FARE_API_KEY');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, 'json');
  }
  const q = parseFareQuery(body);
  if (typeof q === 'string') return reply(400, q);
  const cacheReq = new Request(
    `https://cache.invalid/${await sha256(`fare:${JSON.stringify(q)}`)}`,
  );
  const hit = await d.cache.match(cacheReq);
  if (hit)
    return new Response(hit.body, {
      status: 200,
      headers: { ...h, 'Content-Type': 'application/xml', 'X-Cache': 'hit' },
    });
  // Two calls upstream: both count.
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await d.limit(ip)) || !(await d.limit(ip)))
    return reply(429, 'rate', { 'Retry-After': '60' });
  const ask = async (url: string, key: string, xml: string) => {
    try {
      return await d.fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/xml' },
        body: xml,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  };
  const trips = await ask(d.upstream, d.apiKey, fareTripRequestXml(q, d.now(), REQUESTOR));
  if (!trips?.ok) return reply(502, `upstream ${trips?.status ?? 'none'}`);
  const trip = pickTrip(await trips.text(), q.journeys);
  if (!trip) return reply(404, 'trip not found');
  const up = await ask(d.fareUpstream, d.fareKey, fareRequestXml(trip, q, d.now(), REQUESTOR));
  if (!up?.ok) {
    // The service's own words (its gateway says why it refused), never our request or key.
    const why = up ? (await up.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200) : '';
    return reply(
      up?.status === 429 ? 503 : 502,
      `fare upstream ${up?.status ?? 'none'}${why ? `: ${why}` : ''}`,
    );
  }
  const text = await up.text();
  // Kept only with a price in it: an empty delivery or an error is asked again next time.
  if (/<(?:\w+:)?FareProduct>/.test(text) && !/<(?:\w+:)?ErrorCondition>/.test(text))
    d.defer(
      d.cache.put(
        cacheReq,
        new Response(text, {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': `public, max-age=${FARE_CACHE_S}`,
          },
        }),
      ),
    );
  return new Response(text, {
    status: 200,
    headers: {
      ...h,
      'Content-Type': 'application/xml',
      'X-Cache': 'miss',
    },
  });
}

/** How Transitous is asked to know who asks (its fair-use rules ask clients to say so). */
const UA = 'Viadukt (https://github.com/jibes/swiss-rail-routes)';

/**
 * POST /eu/stops and /eu/plan (0.31.0): stations abroad and trips there, from Transitous, as
 * typed JSON in and JSON out; cached 10 minutes, counted as OJP's are.
 */
async function europe(
  path: string,
  req: Request,
  d: Deps,
  reply: (status: number, body: string, extra?: Record<string, string>) => Response,
  h: Record<string, string>,
): Promise<Response> {
  if (!d.transitous) return reply(503, 'not configured: TRANSITOUS_URL');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, 'json');
  }
  const stops = path === '/eu/stops';
  const q = stops ? parseEuStopQuery(body) : parseEuPlanQuery(body);
  if (typeof q === 'string') return reply(400, q);
  const url = stops ? euStopsUrl(d.transitous, q as never) : euPlanUrl(d.transitous, q as never);
  const cacheReq = new Request(`https://cache.invalid/${await sha256(url)}`);
  const json = { ...h, 'Content-Type': 'application/json' };
  const hit = await d.cache.match(cacheReq);
  if (hit) return new Response(hit.body, { status: 200, headers: { ...json, 'X-Cache': 'hit' } });
  if (!(await d.limit(req.headers.get('CF-Connecting-IP') ?? 'unknown')))
    return reply(429, 'rate', { 'Retry-After': '60' });
  let up: Response;
  try {
    up = await d.fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return reply(502, 'upstream');
  }
  if (!up.ok) return reply(up.status === 429 ? 503 : 502, `upstream ${up.status}`);
  const text = stops ? JSON.stringify(euStations(await up.json())) : await up.text();
  d.defer(
    d.cache.put(
      cacheReq,
      new Response(text, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      }),
    ),
  );
  return new Response(text, { status: 200, headers: { ...json, 'X-Cache': 'miss' } });
}

/** A forecast is kept an hour: the models run every few hours, and Open-Meteo's free use counts. */
const WEATHER_CACHE_S = 3600;

/**
 * Weather along a trip (0.37.0): Open-Meteo for rounded places and at most two days, from typed
 * JSON. Its free use is limited per address, which the Worker shares with others: refused, it
 * says busy (503), and the app shows no stripe that time.
 */
async function weather(
  req: Request,
  d: Deps,
  reply: (status: number, body: string, extra?: Record<string, string>) => Response,
  h: Record<string, string>,
): Promise<Response> {
  if (!d.weatherUpstream) return reply(503, 'not configured: WEATHER_URL');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, 'json');
  }
  const q = parseWeatherQuery(body);
  if (typeof q === 'string') return reply(400, q);
  const url = weatherUrl(d.weatherUpstream, q);
  const cacheReq = new Request(`https://cache.invalid/${await sha256(url)}`);
  const json = { ...h, 'Content-Type': 'application/json' };
  const hit = await d.cache.match(cacheReq);
  if (hit) return new Response(hit.body, { status: 200, headers: { ...json, 'X-Cache': 'hit' } });
  if (!(await d.limit(req.headers.get('CF-Connecting-IP') ?? 'unknown')))
    return reply(429, 'rate', { 'Retry-After': '60' });
  let up: Response;
  try {
    up = await d.fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return reply(502, 'upstream');
  }
  const text = await up.text();
  // Open-Meteo says a refusal in the body too ({"error":true,"reason":"Daily API request limit…"}).
  if (!up.ok || /^\s*\{\s*"error"\s*:\s*true/.test(text))
    return reply(up.status === 429 || /limit/i.test(text) ? 503 : 502, 'weather busy');
  d.defer(
    d.cache.put(
      cacheReq,
      new Response(text, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${WEATHER_CACHE_S}`,
        },
      }),
    ),
  );
  return new Response(text, { status: 200, headers: { ...json, 'X-Cache': 'miss' } });
}
