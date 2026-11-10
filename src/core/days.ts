// Where a trip's day changes (0.44.0; 0.50.1 by the time it changes at): the new day stands by
// the first time on it, a station's arrival or its departure, Zurich's day, against the time
// before; the first only when not the trip's own day. Pure.
import type { LineRow } from './rows';
import { dayOf } from './trip';

export type DayMarks = Map<number, { arr?: string; dep?: string }>;

/** For each station row where a day begins, that day by its arrival and/or departure. */
export function dayMarks(
  rows: LineRow[],
  tripDay: string | undefined,
  skip: ReadonlySet<number>,
): DayMarks {
  const marks: DayMarks = new Map();
  let day = tripDay;
  rows.forEach((r, i) => {
    if (r.type !== 'station' || skip.has(i)) return;
    for (const side of ['arr', 'dep'] as const) {
      const at = r[side];
      if (!at) continue;
      const d = dayOf(Date.parse(at));
      if (day && d !== day) marks.set(i, { ...marks.get(i), [side]: d });
      day = d;
    }
  });
  return marks;
}
