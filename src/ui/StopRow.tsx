import type { Waypoint } from '../core/model';
import { useT } from '../store';
import { Icon } from './icons';

export const DWELLS = [15, 30, 60, 90, 120] as const;

/** 90 → "1h30", 60 → "1h", 30 → "30′". */
export const dwellLabel = (min: number) =>
  min < 60
    ? `${min}′`
    : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

interface Props {
  w: Waypoint;
  index: number;
  count: number;
  caption?: string;
  last: boolean;
  open: boolean;
  onToggle: () => void;
  onStop: (stop: boolean) => void;
  onDwell: (min: number) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}

/** A station on the line. Tap to open its few options in place. */
export function StopRow(p: Props) {
  const t = useT();
  const { w } = p;
  const inner = w.kind !== 'start' && w.kind !== 'end';
  const off = w.kind === 'stop' || w.kind === 'turnaround';
  const id = `stop-${p.index}`;
  return (
    <li className={`stop ${w.kind === 'via' ? 'via' : ''} ${p.last ? 'last' : ''}`}>
      <span className="dot" aria-hidden="true" />
      <button
        type="button"
        className="stop-head"
        aria-expanded={p.open}
        aria-controls={id}
        onClick={p.onToggle}
      >
        <span className="stop-name">
          <span>{w.name}</span>
          {p.caption && <small>{p.caption}</small>}
        </span>
        {off && w.dwellMin > 0 && <span className="dwell-tag">{dwellLabel(w.dwellMin)}</span>}
      </button>
      {p.open && (
        <div id={id} className="stop-tools">
          {inner && (
            <label className="pill toggle-pill">
              <input type="checkbox" checked={off} onChange={(e) => p.onStop(e.target.checked)} />
              {t('getOff')}
            </label>
          )}
          {off &&
            DWELLS.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={w.dwellMin === m}
                onClick={() => p.onDwell(m)}
              >
                {dwellLabel(m)}
              </button>
            ))}
          <span className="spacer" />
          <button
            type="button"
            className="icon"
            aria-label={t('moveUp', { name: w.name })}
            disabled={p.index === 0}
            onClick={() => p.onMove(p.index - 1)}
          >
            <Icon name="up" size={18} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label={t('moveDown', { name: w.name })}
            disabled={p.index === p.count - 1}
            onClick={() => p.onMove(p.index + 1)}
          >
            <Icon name="down" size={18} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label={t('remove', { name: w.name })}
            onClick={p.onRemove}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
    </li>
  );
}
