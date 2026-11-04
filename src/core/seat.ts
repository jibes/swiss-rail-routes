// Which side to sit on for the views, per ride: a line's side is given in its chain's order
// (`RouteTemplate.seat`, from `seatFrom` on when only part of it has the view); a ride along the
// line the other way sits on the other side. Pure.
import type { RouteTemplate } from './data';
import type { Section } from './model';
import { stopKey } from './stops';

export type Side = 'L' | 'R';

export const flipSide = (s: Side): Side => (s === 'L' ? 'R' : 'L');

/**
 * The way a ride runs along a line: forward (chain order), back, or not along it (fewer than two
 * of `chain`'s stations among its calls). `from` limits the chain to the part from that station.
 */
export function directionOn(
  s: Section,
  t: Pick<RouteTemplate, 'chain'>,
  from?: string,
): { forward: boolean; stations: number } | undefined {
  const start = from ? t.chain.findIndex((x) => stopKey(x.ref) === stopKey(from)) : 0;
  const at = new Map(t.chain.slice(Math.max(0, start)).map((x, i) => [stopKey(x.ref), i]));
  const seen = [s.from, ...s.intermediate, s.to]
    .map((c) => at.get(stopKey(c.stopRef)))
    .filter((i): i is number => i !== undefined);
  if (seen.length < 2 || seen[0] === seen.at(-1)) return undefined;
  return { forward: seen.at(-1)! > seen[0]!, stations: seen.length };
}

/** The side to sit on for a ride, from the line it runs along the most (none on a walk). */
export function seatOn(s: Section, templates: RouteTemplate[]): Side | undefined {
  if (s.mode === 'walk') return undefined;
  let best: { side: Side; stations: number } | undefined;
  for (const t of templates) {
    if (!t.seat) continue;
    const d = directionOn(s, t, t.seatFrom);
    if (!d || (best && best.stations >= d.stations)) continue;
    best = { side: d.forward ? t.seat : flipSide(t.seat), stations: d.stations };
  }
  return best?.side;
}
