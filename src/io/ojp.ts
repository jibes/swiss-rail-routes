// Trip requests through the OJP Worker (VITE_OJP_URL); answers parsed on the device.
import type { Connection } from '../core/model';
import type { TripQuery } from '../core/ojp/request';
import { log } from './log';

export const ojpConfigured = () => !!import.meta.env.VITE_OJP_URL;

/** A request that hangs (a stalled mobile connection) ends after 30 s, like any failure. */
const TIMEOUT_MS = 30_000;
const withTimeout = (signal?: AbortSignal) => {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  if (!signal) return t;
  if ('any' in AbortSignal) return AbortSignal.any([signal, t]);
  // WebView 111–115 has no AbortSignal.any: one controller that either aborts.
  const both = new AbortController();
  const stop = (s: AbortSignal) => () => both.abort(s.reason);
  if (signal.aborted) both.abort(signal.reason);
  signal.addEventListener('abort', stop(signal), { once: true });
  t.addEventListener('abort', stop(t), { once: true });
  return both.signal;
};

export class PlanningUnavailable extends Error {}

/** Longest wait before a retry: longer, and the screen says it is busy instead. */
const MAX_WAIT_MS = 10_000;

/** The server's `Retry-After` (seconds), else `fallback`. */
export function retryAfterMs(res: Response, fallback: number): number {
  const s = Number(res.headers.get('Retry-After'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : fallback;
}

/** The Worker answered with an error; `detail` is its status and short text. */
export class WorkerError extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

export async function fetchTrips(q: TripQuery, signal?: AbortSignal): Promise<Connection[]> {
  const url = import.meta.env.VITE_OJP_URL;
  if (!url) throw new PlanningUnavailable();
  // A leg with an end abroad (0.33.0): Transitous, through the Worker, the whole leg.
  if ([q.origin, q.destination].some((s) => s.ref.startsWith('eu:')))
    return fetchEuTrips(url, q, signal);
  const { parseTrips } = await import('../core/ojp/parse');
  const what = {
    from: q.origin.name,
    to: q.destination.name,
    via: q.vias.map((v) => v.name),
    time: q.time,
    arriveBy: q.arriveBy,
  };
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(`${url.replace(/[/]$/, '')}/trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q),
        signal: withTimeout(signal),
      });
    } catch (e) {
      log('ojp.trip.fail', { ...what, attempt, e, aborted: signal?.aborted });
      throw e;
    }
    const ms = Math.round(performance.now() - t0);
    // Rate-limited (Worker 429, OJP quota 503): wait as asked and try twice more, unless the
    // wait is longer than a person waits for an answer (the Worker's limit: a minute).
    const wait = retryAfterMs(res, 3000 * (attempt + 1));
    if ((res.status === 429 || res.status === 503) && attempt < 2 && wait <= MAX_WAIT_MS) {
      log('ojp.trip.retry', { ...what, status: res.status, attempt, ms, wait });
      await new Promise((r) => setTimeout(r, wait));
      signal?.throwIfAborted();
      continue;
    }
    if (!res.ok) {
      const detail = `${res.status} ${(await res.text()).slice(0, 80)}`;
      log('ojp.trip.fail', { ...what, detail, attempt, ms });
      throw new WorkerError(detail);
    }
    const text = await res.text();
    const out = parseTrips(text);
    log('ojp.trip', {
      ...what,
      ms,
      bytes: text.length,
      cache: res.headers.get('X-Cache') ?? undefined,
      connections: out.length,
      disrupted: out.filter((c) => c.sections.some((s) => s.notices?.length)).length,
      ev: out.filter((c) => c.sections.some((s) => s.category === 'EV')).length,
    });
    return out;
  }
}

/** Live calls of one vehicle (OJP TripInfo via the Worker, cached there 30 s). */
export async function fetchJourney(
  q: import('../core/ojp/request').JourneyQuery,
  signal?: AbortSignal,
): Promise<import('../core/ojp/journey').JourneyStatus> {
  const url = import.meta.env.VITE_OJP_URL;
  if (!url) throw new PlanningUnavailable();
  const [res, { parseJourney }] = await Promise.all([
    fetch(`${url.replace(/[/]$/, '')}/journey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
      signal: withTimeout(signal),
    }),
    import('../core/ojp/journey'),
  ]);
  if (!res.ok) {
    const detail = `${res.status} ${(await res.text()).slice(0, 80)}`;
    log('ojp.journey.fail', { journey: q, detail });
    throw new WorkerError(detail);
  }
  const out = parseJourney(await res.text());
  log('ojp.journey', { journey: q, status: out });
  return out;
}

/** A leg abroad (0.33.0) from Transitous through the Worker (`euLeg`, shared with the MCP). */
async function fetchEuTrips(
  url: string,
  q: TripQuery,
  signal?: AbortSignal,
): Promise<Connection[]> {
  const [{ stopSearch }, { euLeg }] = await Promise.all([
    import('./stops'),
    import('../core/eu/leg'),
  ]);
  const index = await stopSearch();
  const what = { from: q.origin.name, to: q.destination.name, time: q.time, arriveBy: q.arriveBy };
  const t0 = performance.now();
  let cache: string | undefined;
  const out = await euLeg(q, {
    index,
    trace: (event, data) => log(event, { ...what, ...(data as object) }),
    plan: async (body) => {
      const res = await fetch(`${url.replace(/[/]$/, '')}/eu/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: withTimeout(signal),
      });
      if (!res.ok) {
        const detail = `${res.status} ${(await res.text()).slice(0, 80)}`;
        log('eu.plan.fail', { ...what, detail });
        throw new WorkerError(detail);
      }
      cache = res.headers.get('X-Cache') ?? undefined;
      return res.json();
    },
  });
  log('eu.plan', {
    ...what,
    ms: Math.round(performance.now() - t0),
    cache,
    connections: out.length,
    vias: q.vias.length || undefined,
  });
  return out;
}

/** Stations abroad by name (Transitous through the Worker), asked only when the person asks. */
export async function fetchEuStops(
  text: string,
  signal?: AbortSignal,
): Promise<import('../core/eu/request').EuStop[]> {
  const url = import.meta.env.VITE_OJP_URL;
  if (!url) throw new PlanningUnavailable();
  const res = await fetch(`${url.replace(/[/]$/, '')}/eu/stops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: withTimeout(signal),
  });
  if (!res.ok) {
    const detail = `${res.status} ${(await res.text()).slice(0, 80)}`;
    log('eu.stops.fail', { detail });
    throw new WorkerError(detail);
  }
  const out = (await res.json()) as import('../core/eu/request').EuStop[];
  log('eu.stops', { results: out.length });
  return out;
}
