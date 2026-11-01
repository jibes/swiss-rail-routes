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
    <div
      role="tablist"
      className="tabs"
      aria-label={t('alternatives')}
      // Arrow keys, Home and End move between the options (one Tab stop for the group).
      onKeyDown={(e) => {
        const i = options.findIndex((c) => c === shown);
        const to =
          e.key === 'ArrowRight' || e.key === 'ArrowDown'
            ? Math.min(i + 1, options.length - 1)
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
              ? Math.max(i - 1, 0)
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? options.length - 1
                  : -1;
        if (to < 0) return;
        e.preventDefault();
        onPick(options[to]!.dep);
        e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
      }}
    >
      {options.map((c) => (
        <button
          key={c.dep}
          role="tab"
          type="button"
          aria-selected={c === shown}
          tabIndex={c === shown ? 0 : -1}
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
