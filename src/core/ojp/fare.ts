// Fares (0.31.0): what OJP Fare (NOVA) answers for a leg, and the question for one. Recorded
// answers (Nov 2026) hold one product per class, the cheapest (a saver ticket where there is
// one: "Sparbillett"), whatever class was asked; a price is CHF with VAT. Pure.
import type { Connection } from '../model';
import { zurichLocal } from '../planner/plan';
import { stopKey } from '../stops';
import type { FareQuery } from './fareRequest';

export interface Fare {
  /** The product's name as NOVA gives it (German): "Sparbillett", "Einzelbillett"… */
  name: string;
  /** CHF, VAT included. */
  price: number;
  travelClass: 1 | 2;
}

const tag = (block: string, name: string) =>
  new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(block)?.[1]?.trim();

/** The products of an answer, the cheapest per class first; none from an answer without any. */
export function parseFares(xml: string): Fare[] {
  const out: Fare[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?FareProduct>([\s\S]*?)<\/(?:\w+:)?FareProduct>/g)) {
    const b = m[1]!;
    const price = Number(tag(b, 'Price'));
    const cls = tag(b, 'FareClass');
    if (!Number.isFinite(price) || (tag(b, 'Currency') ?? 'CHF') !== 'CHF') continue;
    if (cls !== 'firstClass' && cls !== 'secondClass') continue;
    out.push({
      name: tag(b, 'FareProductName') ?? '',
      price,
      travelClass: cls === 'firstClass' ? 1 : 2,
    });
  }
  return out.sort((a, b) => a.travelClass - b.travelClass || a.price - b.price);
}

/** The cheapest in a class. */
export const cheapest = (fares: Fare[], travelClass: 1 | 2) =>
  fares.find((f) => f.travelClass === travelClass);

/**
 * The question for a leg: its first ride's stop and time, its last ride's stop, the stops
 * where it changes as vias (OJP keeps to the first), and its trains, by which the Worker finds
 * the very trip among OJP's own. None for a leg OJP Fare cannot know: a ride without its
 * journey (a link not yet refreshed) or one abroad.
 */
export function fareQueryOf(c: Connection, halfFare: boolean): FareQuery | undefined {
  const rides = c.sections.filter((s) => s.mode !== 'walk');
  const first = rides[0];
  const last = rides.at(-1);
  if (!first?.from.dep || !last) return undefined;
  const journeys = rides.map((s) => s.journey?.replace(/^\d{4}-\d{2}-\d{2}:/, ''));
  if (journeys.some((j) => !j || j.startsWith('eu:') || /^plan:|:ojp:/.test(j))) return undefined;
  const ref = (s: { stopRef: string; name: string }) => ({ ref: stopKey(s.stopRef), name: s.name });
  const vias = rides.slice(1).map((s) => ref(s.from));
  return {
    origin: ref(first.from),
    destination: ref(last.to),
    vias: vias.filter((v, i) => vias.findIndex((w) => w.ref === v.ref) === i).slice(0, 10),
    time: zurichLocal(Date.parse(first.from.dep)).slice(0, 16),
    journeys: journeys as string[],
    travelClass: 2,
    halfFare,
  };
}
