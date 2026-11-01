import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { StopPicker } from './StopPicker';
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
  /** Where you are: no options, no grip (the replan start). */
  fixed?: boolean;
  /** Swap the station; absent where it cannot change (the replan start). */
  onReplace?: (stop: { stopRef: string; name: string }) => void;
  style?: CSSProperties;
  dragging?: boolean;
  grip: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

/** A station on the line. Tap to open its few options in place. */
export function StopRow(p: Props) {
  const t = useT();
  const [changing, setChanging] = useState(false);
  const { w } = p;
  const inner = w.kind !== 'start' && w.kind !== 'end';
  const off = w.kind === 'stop' || w.kind === 'turnaround';
  const id = `stop-${p.index}`;
  return (
    <li
      className={`stop ${p.fixed ? 'fixed' : ''} ${w.kind === 'via' ? 'via' : ''} ${p.last ? 'last' : ''} ${p.dragging ? 'dragging' : ''}`}
      style={p.style}
    >
      <span className="dot" aria-hidden="true" />
      <div className="stop-top">
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
        {!p.fixed && (
          <button
            type="button"
            className="grip"
            aria-label={t('drag', { name: w.name })}
            aria-keyshortcuts="ArrowUp ArrowDown"
            data-grip={p.index}
            {...p.grip}
          >
            <Icon name="grip" size={20} />
          </button>
        )}
      </div>
      {!p.fixed && p.open && changing && p.onReplace && (
        <div className="stop-change">
          <StopPicker
            label={t('changeTo', { name: w.name })}
            autoFocus
            onPick={(s) => {
              p.onReplace!({ stopRef: s.ref, name: s.name });
              setChanging(false);
            }}
          />
        </div>
      )}
      {!p.fixed && p.open && (
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
          {p.onReplace && (
            <button
              type="button"
              className="chip"
              aria-expanded={changing}
              onClick={() => setChanging((c) => !c)}
            >
              {t('change')}
            </button>
          )}
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
