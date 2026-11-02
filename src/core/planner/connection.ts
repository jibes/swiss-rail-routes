// Read-only helpers over a Connection.
import type { Connection, Section } from '../model';
import { stopKey } from '../stops';

export const MIN = 60_000;
export const ms = (iso: string) => Date.parse(iso);

export const rides = (c: Connection): [Section, number][] =>
  c.sections.map((s, i) => [s, i] as [Section, number]).filter(([s]) => s.mode !== 'walk');

export interface Call {
  key: string;
  /** Departure, else arrival, in ms; undefined when OJP gave no time. */
  at?: number;
  sectionIndex: number;
}

/** Every stop the rides call at, in order, as stop keys. */
export function calls(c: Connection): Call[] {
  const out: Call[] = [];
  for (const [s, i] of rides(c)) {
    for (const x of [s.from, ...s.intermediate, s.to]) {
      const t = x.dep ?? x.arr;
      const key = stopKey(x.stopRef);
      if (out.at(-1)?.key === key) continue;
      out.push({ key, at: t ? ms(t) : undefined, sectionIndex: i });
    }
  }
  return out;
}

export const stopSeq = (c: Connection) => calls(c).map((x) => x.key);

/**
 * Every stop a connection takes you to, walks included. OJP passes a via by its exact stop,
 * walking through the station when the train or bus stops beside it (Bergün/Bravuogn, posta →
 * Bergün/Bravuogn → posta); a via counts as passed when it is one of these.
 */
export const visited = (c: Connection) =>
  new Set(
    c.sections.flatMap((s) => [s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef))),
  );

/** Minutes between arriving with one ride and leaving with the next (walks count as transfer). */
export function transferGaps(c: Connection): { afterSection: number; min: number }[] {
  const r = rides(c);
  const gaps: { afterSection: number; min: number }[] = [];
  for (let k = 0; k + 1 < r.length; k++) {
    const [a, i] = r[k]!;
    const [b] = r[k + 1]!;
    if (a.to.arr && b.from.dep)
      gaps.push({ afterSection: i, min: (ms(b.from.dep) - ms(a.to.arr)) / MIN });
  }
  return gaps;
}

export const durationMin = (c: Connection) => (ms(c.arr) - ms(c.dep)) / MIN;
