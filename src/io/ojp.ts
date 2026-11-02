// Trip requests through the OJP Worker (VITE_OJP_URL); answers parsed on the device.
import type { Connection } from '../core/model';
import type { TripQuery } from '../core/ojp/request';
import { log } from './log';

export const ojpConfigured = () => !!import.meta.env.VITE_OJP_URL;

/** A request that hangs (a stalled mobile connection) ends after 30 s, like any failure. */
const TIMEOUT_MS = 30_000;
const withTimeout = (signal?: AbortSignal) => {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  return signal && 'any' in AbortSignal ? AbortSignal.any([signal, t]) : (signal ?? t);
};

export class PlanningUnavailable extends Error {}

/** The Worker answered with an error; `detail` is its status and short text. */
export class WorkerError extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

export async function fetchTrips(q: TripQuery, signal?: AbortSignal): Promise<Connection[]> {
  const url = import.meta.env.VITE_OJP_URL;
  if (!url) throw new PlanningUnavailable();
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
    // Rate-limited (Worker 429, OJP quota 503): wait and try twice more.
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      log('ojp.trip.retry', { ...what, status: res.status, attempt, ms });
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
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
