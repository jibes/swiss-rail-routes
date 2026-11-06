// Where you change trains, the platform you arrive on and the one the next train leaves from
// (0.17.3): "Pl. 7 → 8", or "same platform". Pure: which rows are a change, and what to say.
import { runsOn } from './planner/connection';
import type { LineRow, RideRow } from './rows';

/**
 * The ride you arrive with at row `i` and the one you leave with (none when you walk on to
 * another stop), where you get off one train for another or stay. Nothing at the start, the end,
 * a station a train passes, or where the same train goes on.
 */
export function changeAt(rows: LineRow[], i: number): { arr: RideRow; dep?: RideRow } | undefined {
  const r = rows[i];
  if (r?.type !== 'station' || r.role === 'start' || r.role === 'end') return undefined;
  const before = rows[i - 1];
  const after = rows[i + 1];
  if (before?.type !== 'ride' || before.section.mode === 'walk') return undefined;
  if (after?.type !== 'ride') return undefined;
  if (after.section.mode === 'walk') return { arr: before };
  return runsOn(before.section, after.section) ? undefined : { arr: before, dep: after };
}

export type ChangePlatforms =
  | { kind: 'same'; p: string }
  | { kind: 'both'; arr: string; dep: string }
  | { kind: 'arr'; arr: string };

/**
 * What the row says: both platforms, "same platform", or only where you arrive when the next
 * train leaves from another stop; nothing when a platform it needs is not known.
 */
export function changePlatforms(
  arr?: string,
  dep?: string,
  walkOn = false,
): ChangePlatforms | undefined {
  if (!arr) return undefined;
  if (walkOn) return { kind: 'arr', arr };
  if (!dep) return undefined;
  return arr === dep ? { kind: 'same', p: arr } : { kind: 'both', arr, dep };
}

/**
 * The line the same train runs on as at row `i`, where it takes another number there (the S29
 * on as the S1): said in place of a change. Nothing where the line stays the same.
 */
export function continuesAs(rows: LineRow[], i: number): string | undefined {
  const r = rows[i];
  const before = rows[i - 1];
  const after = rows[i + 1];
  if (r?.type !== 'station' || before?.type !== 'ride' || after?.type !== 'ride') return undefined;
  if (!runsOn(before.section, after.section)) return undefined;
  const name = (x: RideRow) => x.section.line ?? x.section.number;
  const next = name(after);
  return next && next !== name(before) ? next : undefined;
}
