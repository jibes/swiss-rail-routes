// Trip requests through the OJP Worker (VITE_OJP_URL). The XML parser arrives with the
// recorded fixtures (src/core/ojp/parse.ts); until then planning reports itself unavailable.
import type { Connection } from '../core/model';
import type { TripQuery } from '../core/ojp/request';

export const ojpConfigured = () => !!import.meta.env.VITE_OJP_URL;

export class PlanningUnavailable extends Error {}

let parser: ((xml: string) => Connection[]) | undefined;
export const setTripParser = (p: (xml: string) => Connection[]) => {
  parser = p;
};

export async function fetchTrips(q: TripQuery, signal?: AbortSignal): Promise<Connection[]> {
  const url = import.meta.env.VITE_OJP_URL;
  if (!url || !parser) throw new PlanningUnavailable();
  const res = await fetch(`${url.replace(/[/]$/, '')}/trip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(q),
    signal,
  });
  if (!res.ok) throw new Error(`worker ${res.status}`);
  return parser(await res.text());
}
