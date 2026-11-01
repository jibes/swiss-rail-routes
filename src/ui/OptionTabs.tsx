import type { PlannedChain } from '../core/planner/plan';
import { useT } from '../store';
import { duration, hhmm, minutesBetween } from './format';

/** The options of a plan by departure; one option is a note, not a tab. */
export function OptionTabs({
  options,
  recommended,
  shown,
  onPick,
}: {
  options: PlannedChain[];
  recommended?: PlannedChain;
  shown?: PlannedChain;
  onPick: (dep: string) => void;
}) {
  const t = useT();
  if (options.length < 2) return <p className="single muted">{t('onlyOne')}</p>;
  return (
    <div role="tablist" className="tabs" aria-label={t('alternatives')}>
      {options.map((c) => (
        <button
          key={c.dep}
          role="tab"
          type="button"
          aria-selected={c === shown}
          onClick={() => onPick(c.dep)}
        >
          <span className="times">{hhmm(c.dep)}</span>
          <span className={`sub ${c === recommended ? 'rec' : ''}`}>
            {c === recommended ? t('recommended') : duration(minutesBetween(c.dep, c.arr))}
          </span>
        </button>
      ))}
    </div>
  );
}
