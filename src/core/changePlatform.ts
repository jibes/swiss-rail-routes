// Platforms at the stations (0.17.3 a line under a change, "Pl. 7 → 8"; since 0.50.0 beside the
// station's names, the arrival's and the departure's) and where the same train runs on under
// another number. Pure.
import { runsOn } from './planner/connection';
import type { LineRow, RideRow } from './rows';

/**
 * The platforms a station row shows beside its names (0.50.0: a platform is the station's, not
 * the train's): the one you arrive on beside where you get off (the end, a change, a stay, a
 * station you walk on from) and the one you leave from beside where you board (the start, a
 * change, a station you walked to). None where the same train runs on, and none on foot.
 * `skip`: rows drawn inside a ride, passed over to find the rides either side.
 */
export function stationPlatforms(
  rows: LineRow[],
  i: number,
  skip: ReadonlySet<number> = new Set(),
): { arr?: RideRow; dep?: RideRow } {
  if (rows[i]?.type !== 'station') return {};
  let b = i - 1;
  while (b >= 0 && skip.has(b)) b--;
  let a = i + 1;
  while (a < rows.length && skip.has(a)) a++;
  const ride = (x: LineRow | undefined) =>
    x?.type === 'ride' && x.section.mode !== 'walk' ? x : undefined;
  const arr = ride(rows[b]);
  const dep = ride(rows[a]);
  if (arr && dep && runsOn(arr.section, dep.section)) return {};
  return { ...(arr ? { arr } : {}), ...(dep ? { dep } : {}) };
}

/**
 * The line the same train runs on as at row `i`, where it takes another number there (the S29
 * on as the S1): said in place of a change. Nothing where the line stays the same.
 */
export function continuesAs(
  rows: LineRow[],
  i: number,
): { line: string; likely: boolean } | undefined {
  const r = rows[i];
  const before = rows[i - 1];
  const after = rows[i + 1];
  if (r?.type !== 'station' || before?.type !== 'ride' || after?.type !== 'ride') return undefined;
  if (!runsOn(before.section, after.section)) return undefined;
  const name = (x: RideRow) => x.section.line ?? x.section.number;
  const next = name(after);
  if (!next || next === name(before)) return undefined;
  // Renumbered and standing a while (by destination and line, not the same minute): probably.
  const a = before.section.to.arr;
  const d = after.section.from.dep;
  const likely =
    before.section.journey !== after.section.journey &&
    !!a &&
    !!d &&
    Date.parse(d) - Date.parse(a) > 60_000;
  return { line: next, likely };
}
