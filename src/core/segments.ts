import type { Segment } from './data';

/**
 * True when the ordered stop sequence of a ride goes from an `a` stop to a `b` stop (or back)
 * without calling at any `via` stop in between.
 */
export function usesSegment(stops: readonly string[], seg: Segment): boolean {
  const a = new Set(seg.a);
  const b = new Set(seg.b);
  const via = new Set(seg.via);
  let open: Set<string> | null = null; // the end set we're heading for
  for (const s of stops) {
    if (via.has(s)) {
      open = null;
      continue;
    }
    if (open?.has(s)) return true;
    if (a.has(s)) open = b;
    else if (b.has(s)) open = a;
  }
  return false;
}
