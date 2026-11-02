import type { RouteTemplate } from '../core/data';
import type { LatLon } from '../core/model';
import { TEMPLATES } from '../data';

export { TEMPLATES };

const km = (a: LatLon, b: LatLon) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 76);

/** Runs a route the way that continues from `from`: reversed when its far end is nearer. */
export function directionFrom(
  tp: RouteTemplate,
  from: LatLon | undefined,
  stop: (ref: string) => LatLon | undefined,
): boolean {
  if (!from) return false;
  const a = stop(tp.chain[0]!.ref);
  const b = stop(tp.chain.at(-1)!.ref);
  return !!a && !!b && km(from, b) < km(from, a);
}
