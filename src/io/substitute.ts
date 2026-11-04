// A station struck through: on a tap, the nearest station that works in its place (SPEC §3
// "Auto-fix"). At most MAX_TRIES planner runs, one after the other, through the trip's own
// planning path (kept answers), stopping at the first that reaches it; nothing is saved or
// applied: the trip changes only if you choose Use.
import { candidates, minutesLater, reaches, trialRoute } from '../core/substitute';
import type { Trip } from '../core/trip';
import { TEMPLATES } from '../data';
import { log } from './log';
import { planRoute } from './planTrip';
import { stopSearch } from './stops';

export interface Found {
  stopRef: string;
  name: string;
  /** When the trip would arrive with it. */
  arr: string;
  /** Minutes against the trip's plan, when it has one. */
  later?: number;
}

export async function findSubstitute(
  trip: Trip,
  k: number,
  signal: AbortSignal,
  /** Stations never to offer besides the route's own (replan: the way here). */
  exclude: string[] = [],
): Promise<Found | null> {
  const index = await stopSearch();
  const tries = candidates(trip.route, k, index, TEMPLATES, exclude);
  log('substitute.try', { trip: trip.id, entry: k, candidates: tries.map((c) => c.name) });
  for (const c of tries) {
    signal.throwIfAborted();
    const route = trialRoute(trip.route, k, c);
    let chain;
    try {
      const r = await planRoute({ ...trip, route }, signal, false);
      chain = r.recommended ?? r.options?.[0];
    } catch (e) {
      if (signal.aborted) throw e;
      log('substitute.fail', { trip: trip.id, name: c.name, e });
      continue;
    }
    if (chain && reaches(route, k, chain.connections)) {
      const found: Found = {
        stopRef: c.stopRef,
        name: c.name,
        arr: chain.arr,
        ...(trip.chain ? { later: minutesLater(trip.chain.arr, chain.arr) } : {}),
      };
      log('substitute.found', { trip: trip.id, name: c.name, later: found.later });
      return found;
    }
  }
  log('substitute.none', { trip: trip.id, tried: tries.length });
  return null;
}
