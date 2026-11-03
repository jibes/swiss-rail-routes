import type { RouteTemplate } from '../core/data';
import type { LatLon } from '../core/model';
import { TEMPLATES } from '../data';

export { TEMPLATES };

const km = (a: LatLon, b: LatLon) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 76);
/** Ends about as far away as each other: the one trains reach comes first (a summit's valley). */
const NEAR_KM = 10;

/**
 * Runs a route the way that continues from `from`: reversed when its far end is nearer. Two
 * ends about as near (Rigi Kulm and Arth-Goldau from Zürich, as the crow flies) start at the
 * one mainline trains call at, so a summit line is offered from its valley station.
 */
export function directionFrom(
  tp: RouteTemplate,
  from: LatLon | undefined,
  stop: (ref: string) => (LatLon & { modes?: readonly string[] }) | undefined,
): boolean {
  if (!from) return false;
  const a = stop(tp.chain[0]!.ref);
  const b = stop(tp.chain.at(-1)!.ref);
  if (!a || !b) return false;
  const da = km(from, a);
  const db = km(from, b);
  const train = (s: { modes?: readonly string[] }) => !!s.modes?.includes('TRAIN');
  if (Math.abs(da - db) < NEAR_KM && train(a) !== train(b)) return train(b);
  return db < da;
}

/** A scenic line's name by its id (a route that is just that line is called by it). */
export const lineName = (id: string) => TEMPLATES.find((x) => x.id === id)?.name;
