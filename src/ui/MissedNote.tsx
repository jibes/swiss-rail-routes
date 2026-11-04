// The note under a station no connection passes: why, "Try an hour later", and on a tap the
// nearest station that works in its place (`find`), to use or dismiss. Keyed by the route, so
// an edit drops a suggestion and stops a search (unmounting aborts it).
import { useEffect, useRef, useState } from 'react';
import { missedByDisruption, type LineRow, type StationRow } from '../core/rows';
import type { Warning } from '../core/warnings';
import type { Found } from '../io/substitute';
import { useT } from '../store';
import { hhmm } from './format';

export type FindSubstitute = (k: number, signal: AbortSignal) => Promise<Found | null>;

type State =
  { s: 'idle' } | { s: 'looking' } | { s: 'found'; f: Found } | { s: 'none' } | { s: 'dismissed' };

export function MissedNote({
  rows,
  i,
  warnings,
  later,
  find,
  use,
}: {
  rows: LineRow[];
  i: number;
  warnings: Warning[];
  /** Absent when nothing is editable. */
  later?: () => void;
  find?: FindSubstitute;
  use?: (k: number, stop: { stopRef: string; name: string }) => void;
}) {
  const t = useT();
  const r = rows[i] as StationRow;
  const disrupted = missedByDisruption(rows, i, warnings);
  const [state, setState] = useState<State>({ s: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const k = r.entry;
  const canFind = !!find && !!use && k !== undefined;

  const look = () => {
    if (!find || k === undefined || state.s === 'looking') return;
    const c = new AbortController();
    ctrl.current = c;
    setState({ s: 'looking' });
    find(k, c.signal).then(
      (f) => {
        if (!c.signal.aborted) setState(f ? { s: 'found', f } : { s: 'none' });
      },
      () => {
        if (!c.signal.aborted) setState({ s: 'none' });
      },
    );
  };

  const delta = (n: number | undefined) =>
    n === undefined || n === 0
      ? ''
      : n > 0
        ? t('substituteLater', { n })
        : t('substituteEarlier', { n: -n });

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
      {canFind && (state.s === 'idle' || state.s === 'looking') && (
        <button
          type="button"
          className="text-button"
          onClick={look}
          aria-disabled={state.s === 'looking'}
        >
          {state.s === 'looking' ? t('substituteLooking') : t('substituteFind')}
        </button>
      )}
      {state.s === 'none' && (
        <span className="substitute" role="status">
          {t('substituteNone')}
        </span>
      )}
      {state.s === 'found' && (
        <span className="substitute" role="status">
          <span>
            {t('substituteFound', {
              name: state.f.name,
              time: hhmm(state.f.arr),
              delta: delta(state.f.later),
              missed: r.name,
            })}
          </span>
          <span className="substitute-actions">
            <button
              type="button"
              className="pill"
              onClick={() => use!(k!, { stopRef: state.f.stopRef, name: state.f.name })}
            >
              {t('substituteUse')}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setState({ s: 'dismissed' })}
            >
              {t('substituteDismiss')}
            </button>
          </span>
        </span>
      )}
    </div>
  );
}
