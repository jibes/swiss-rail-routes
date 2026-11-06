// Read-only helpers over a Connection.
import type { Connection, Section } from '../model';
import { stopKey } from '../stops';

export const MIN = 60_000;
export const ms = (iso: string) => Date.parse(iso);

/** When a connection is expected to leave and arrive: the estimate known, else the timetable. */
export const expectedDep = (c: Connection) => c.depEst ?? c.dep;
export const expectedArr = (c: Connection) => c.arrEst ?? c.arr;

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
    c.sections.flatMap((s) => [
      ...[s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef)),
      // A line's stations its replacement bus passes by road (planner, `markByRoad`).
      ...(s.byRoad ?? []),
    ]),
  );

/** Minutes between arriving with one ride and leaving with the next (walks count as transfer). */
/** A walk's minutes: OJP's own (its interchange time), else from its times, else 0. */
export const walkMinutes = (s: Section): number =>
  s.walkMin ?? (s.from.dep && s.to.arr ? Math.max(0, (ms(s.to.arr) - ms(s.from.dep)) / MIN) : 0);

/** Tight below this many minutes, or below the walk between the two when that is longer. */
export const TIGHT_TRANSFER_MIN = 4;

/** One rule for the plan's warning and the live view: a change is tight when the time between
 * the two vehicles is less than the walk between them or TIGHT_TRANSFER_MIN. */
export const isTight = (gapMin: number, walkMin: number) =>
  gapMin < Math.max(walkMin, TIGHT_TRANSFER_MIN);

/**
 * The same train runs on from `a` into `b`: the same journey, or (retest round 3, 6 Nov 2026: a
 * train continuing under another number was a "0 min" change) two rail rides meeting at the
 * same stop within a minute, from the same platform. OJP marks neither: no stay-seated element in
 * any recorded answer, only two rides. Not a change: no change counted, no tight warning.
 */
export function runsOn(a: Section, b: Section): boolean {
  if (a.journey && a.journey === b.journey) return true;
  if (a.mode !== 'rail' || b.mode !== 'rail' || !a.to?.arr || !b.from?.dep) return false;
  if (stopKey(a.to.stopRef) !== stopKey(b.from.stopRef)) return false;
  const gap = (ms(b.from.dep) - ms(a.to.arr)) / MIN;
  const pa = track(a.to.platform);
  return gap >= 0 && gap <= 1 && !!pa && pa === track(b.from.platform);
}

/** A platform's track, its sector letters left out ("2AB" and "2CD" are both track 2). */
const track = (p?: string) => (p && /^\d+/.exec(p)?.[0]) || p;

/** The changes of a connection: minutes between the rides, and the walk between them. */
export function transferGaps(c: Connection): { afterSection: number; min: number; walk: number }[] {
  const r = rides(c);
  const gaps: { afterSection: number; min: number; walk: number }[] = [];
  for (let k = 0; k + 1 < r.length; k++) {
    const [a, i] = r[k]!;
    const [b, j] = r[k + 1]!;
    const walk = c.sections.slice(i + 1, j).reduce((m, s) => m + walkMinutes(s), 0);
    if (j === i + 1 && runsOn(a, b)) continue;
    if (a.to.arr && b.from.dep)
      gaps.push({ afterSection: i, min: (ms(b.from.dep) - ms(a.to.arr)) / MIN, walk });
  }
  return gaps;
}

export const durationMin = (c: Connection) => (ms(c.arr) - ms(c.dep)) / MIN;
