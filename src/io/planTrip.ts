// Planning a trip's route, shared by the trip screen (usePlanner) and the background planner
// (autoplan): one request per route at a time, the result kept with its options
// (srr.plans.v1) and written into the trip unless its route changed meanwhile.
import { plan, type PlanResult } from '../core/planner/plan';
import { compactTrip, type Trip } from '../core/trip';
import { GA, SEGMENTS, TEMPLATES } from '../data';
import { useTrips } from '../trips';
import { fetchTrips } from './ojp';
import { stopSearch } from './stops';
import { loadPlans, savePlans } from './tours';

export const routeJson = (t: Trip) => JSON.stringify(t.route);

const running = new Map<string, Promise<PlanResult>>();

/**
 * Plans `trip`'s route (the same route asked twice shares one request). `keep: false` asks
 * without saving (more options from another time, the trip itself unchanged).
 */
export function planRoute(trip: Trip, signal?: AbortSignal, keep = true): Promise<PlanResult> {
  const json = routeJson(trip);
  const key = `${trip.id}|${json}|${keep}`;
  const known = running.get(key);
  if (known) return known;
  const p = (async () => {
    const index = await stopSearch();
    const r = await plan(JSON.parse(json) as Trip['route'], {
      fetchTrips: (q) => fetchTrips(q, signal),
      templates: TEMPLATES,
      segments: SEGMENTS,
      ga: GA,
      stop: (ref) => index.byRef(ref),
    });
    if (!keep) return r;
    // Kept for trips that still exist only, so the cache does not grow for good.
    const plans = await loadPlans();
    const ids = new Set(useTrips.getState().trips.map((t) => t.id));
    await savePlans({
      ...Object.fromEntries(Object.entries(plans).filter(([k]) => ids.has(k))),
      [trip.id]: { tourJson: json, at: new Date().toISOString(), result: r },
    });
    return r;
  })().finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

/** The trip takes the recommended option, unless its route changed or it was planned since. */
export function keepPlan(id: string, json: string, r: PlanResult): boolean {
  const chain = r.recommended ?? r.options?.[0];
  if (!chain || !r.legs) return false;
  const legs = r.legs;
  useTrips
    .getState()
    .update(id, (t) =>
      routeJson(t) === json && !t.chain
        ? compactTrip({ ...t, chain, legs, compact: undefined })
        : t,
    );
  return true;
}
