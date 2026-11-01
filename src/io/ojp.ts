// Trip requests through the OJP Worker (VITE_OJP_URL); answers parsed on the device.
import type { Connection } from '../core/model';
import type { TripQuery } from '../core/ojp/request';

export const ojpConfigured = () => !!import.meta.env.VITE_OJP_URL;

export class PlanningUnavailable extends Error {}

export async function fetchTrips(q: TripQuery, signal?: AbortSignal): Promise<Connection[]> {
  const url = import.meta.env.VITE_OJP_URL;
  if (!url) throw new PlanningUnavailable();
  const [res, { parseTrips }] = await Promise.all([
    fetch(`${url.replace(/[/]$/, '')}/trip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
      signal,
    }),
    import('../core/ojp/parse'),
  ]);
  if (!res.ok) throw new Error(`worker ${res.status}`);
  return parseTrips(await res.text());
}
