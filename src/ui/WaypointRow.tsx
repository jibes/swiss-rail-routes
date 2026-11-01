import { DWELL_PRESETS } from '../core/edit';
import type { Waypoint } from '../core/model';
import { useT } from '../store';

interface Props {
  w: Waypoint;
  index: number;
  count: number;
  onStop: (stop: boolean) => void;
  onDwell: (min: number) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}

export function WaypointRow({ w, index, count, onStop, onDwell, onMove, onRemove }: Props) {
  const t = useT();
  const inner = w.kind !== 'start' && w.kind !== 'end';
  const off = w.kind === 'stop' || w.kind === 'turnaround';
  return (
    <li className={`wp wp-${w.kind}`}>
      <div className="wp-main">
        <span className="wp-dot" aria-hidden="true" />
        <span className="wp-name">{w.name}</span>
        {w.templateId && <span className="chip">{w.templateId}</span>}
      </div>
      <div className="wp-tools">
        {inner && (
          <label className="switch">
            <input type="checkbox" checked={off} onChange={(e) => onStop(e.target.checked)} />{' '}
            {t('getOff')}
          </label>
        )}
        {off && (
          <span role="group" aria-label={t('dwell')} className="presets">
            {DWELL_PRESETS.filter((m) => m > 0).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={w.dwellMin === m}
                onClick={() => onDwell(m)}
              >
                {t('minutes', { n: m })}
              </button>
            ))}
            <input
              type="number"
              min={0}
              max={600}
              step={5}
              value={w.dwellMin}
              aria-label={t('dwellMinutes', { name: w.name })}
              onChange={(e) => onDwell(Number(e.target.value))}
            />
          </span>
        )}
        <button
          type="button"
          aria-label={t('moveUp', { name: w.name })}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t('moveDown', { name: w.name })}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          ↓
        </button>
        <button type="button" aria-label={t('remove', { name: w.name })} onClick={onRemove}>
          ×
        </button>
      </div>
    </li>
  );
}
