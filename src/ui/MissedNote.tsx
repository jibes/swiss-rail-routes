// The note under a station no connection passes: why, and "Try an hour later" (0.58.0: the
// search for a station that works in its place is gone; the station is changed as any other).
import { missedByDisruption, type LineRow } from '../core/rows';
import type { Warning } from '../core/warnings';
import { useT } from '../store';

export function MissedNote({
  rows,
  i,
  warnings,
  later,
}: {
  rows: LineRow[];
  i: number;
  warnings: Warning[];
  /** Absent when nothing is editable. */
  later?: () => void;
}) {
  const t = useT();
  const disrupted = missedByDisruption(rows, i, warnings);
  return (
    <div className="missed-note">
      {/* An interruption on that stretch is the likely reason: say so. */}
      <span>{disrupted ? t('notReachedDisrupted') : t('notReached')}</span>
      {/* A disruption (works, a closure) is not over in an hour: no point trying later. */}
      {later && !disrupted && (
        <button type="button" className="text-button" onClick={later}>
          {t('tryLater')}
        </button>
      )}
    </div>
  );
}
