// Which way a scenic line runs where it is put in a route: shared by the add sheet and the MCP.
import type { RouteTemplate } from './data';
import type { LatLon } from './model';
import { stopKey } from './stops';

const km = (a: LatLon, b: LatLon) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 76);
/** Ends about as far away as each other: the one trains reach comes first (a summit's valley). */
const NEAR_KM = 10;

export interface Around {
  /** The station before the line, and where it is. */
  before?: { ref: string; at?: LatLon };
  /** The station after it, and where it is. */
  after?: { ref: string; at?: LatLon };
}

/**
 * Whether a line runs against its chain's order. The station after it being one of its ends
 * decides first (the line leads there: Zürich, Voralpen-Express, Luzern runs from St. Gallen),
 * then the station before being one (it starts there); else it starts at the end nearer the
 * station before; two ends about as near (Rigi Kulm and Arth-Goldau from Zürich) start at the
 * one mainline trains call at. With no station before, it runs towards the station after.
 */
export function lineReversed(
  tp: Pick<RouteTemplate, 'chain'>,
  around: Around,
  stop: (ref: string) => (LatLon & { modes?: readonly string[] }) | undefined,
): boolean {
  const firstRef = stopKey(tp.chain[0]!.ref);
  const lastRef = stopKey(tp.chain.at(-1)!.ref);
  const after = around.after && stopKey(around.after.ref);
  const before = around.before && stopKey(around.before.ref);
  if (after === lastRef || after === firstRef) return after === firstRef;
  if (before === firstRef || before === lastRef) return before === lastRef;
  const a = stop(tp.chain[0]!.ref);
  const b = stop(tp.chain.at(-1)!.ref);
  if (!a || !b) return false;
  const from = around.before?.at;
  if (from) {
    const da = km(from, a);
    const db = km(from, b);
    const train = (s: { modes?: readonly string[] }) => !!s.modes?.includes('TRAIN');
    if (Math.abs(da - db) < NEAR_KM && train(a) !== train(b)) return train(b);
    return db < da;
  }
  const to = around.after?.at;
  return to ? km(to, a) < km(to, b) : false;
}
