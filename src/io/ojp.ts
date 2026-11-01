// Trip requests through the OJP Worker (VITE_OJP_URL); answers parsed on the device.
import type { Connection } from '../core/model';
import type { TripQuery } from '../core/ojp/request';

export const ojpConfigured = () => !!import.meta.env.VITE_OJP_URL;

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
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${url.replace(/[/]$/, '')}/trip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
      signal,
    });
    // Rate-limited (Worker 429, OJP quota 503): wait and try twice more.
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new WorkerError(`${res.status} ${(await res.text()).slice(0, 80)}`);
    return parseTrips(await res.text());
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
      signal,
    }),
    import('../core/ojp/journey'),
  ]);
  if (!res.ok) throw new WorkerError(`${res.status} ${(await res.text()).slice(0, 80)}`);
  return parseJourney(await res.text());
}
