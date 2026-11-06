// Where you change trains: the platform you arrive on and the one the next train leaves from,
// "Pl. 7 → 8" or "Pl. 7 · Same platform" (0.17.3). Under way the trains' reports win, and an
// arrival platform moved shows the planned one struck, as a ride's departure does.
import { changeAt, changePlatforms, continuesAs } from '../core/changePlatform';
import { platformAt } from '../core/live';
import type { LineRow } from '../core/rows';
import { useT } from '../store';
import { rideOf, type LiveCtx } from './lineLive';

export function ChangePlatform({
  rows,
  i,
  live,
}: {
  rows: LineRow[];
  i: number;
  live: LiveCtx | undefined;
}) {
  const t = useT();
  const on = continuesAs(rows, i);
  if (on) return <span className="change-pl">{t('continuesAs', { line: on })}</span>;
  const at = changeAt(rows, i);
  if (!at) return null;
  const arr = platformAt(at.arr.section.to, rideOf(live, at.arr)?.stops.at(-1));
  const dep = at.dep && platformAt(at.dep.section.from, rideOf(live, at.dep)?.stops[0]).now;
  const says = changePlatforms(arr.now, dep, !at.dep);
  if (!says) return null;
  const pl = (p: string) => t('platform', { p });
  const arrives = arr.moved ? (
    <>
      <s>{pl(arr.moved.was)}</s> <b>{pl(arr.moved.now)}</b>
    </>
  ) : (
    pl(says.kind === 'same' ? says.p : says.arr)
  );
  const sr =
    says.kind === 'same'
      ? t('samePlSr', { p: says.p })
      : says.kind === 'both'
        ? t('changePlSr', { a: says.arr, d: says.dep })
        : t('arrPlSr', { a: says.arr });
  return (
    <span className={arr.moved ? 'change-pl moved' : 'change-pl'}>
      <span aria-hidden="true">
        {says.kind === 'arr' ? (
          <>
            {t('arrPl')} {arrives}
          </>
        ) : (
          <>
            {arrives}
            {says.kind === 'both' ? ` → ${says.dep}` : ` · ${t('samePl')}`}
          </>
        )}
      </span>
      <span className="sr-only">
        {sr}
        {arr.moved && `. ${t('platformChanged', { was: arr.moved.was, p: arr.moved.now })}`}
      </span>
    </span>
  );
}
