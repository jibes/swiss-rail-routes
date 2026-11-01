import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { Waypoint } from '../core/model';
import { useT } from '../store';
import { Icon } from './icons';
import { Select } from './Select';
import { StopPicker } from './StopPicker';

export const DWELLS = [15, 30, 60, 90, 120] as const;

/** 90 → "1h30", 60 → "1h", 30 → "30′". */
export const dwellLabel = (min: number) =>
  min < 60
    ? `${min}′`
    : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

interface Props {
  w: Waypoint;
  index: number;
  caption?: string;
  last: boolean;
  /** 0 rides through; start and end have no stay. */
  onStay: (min: number) => void;
  onRemove: () => void;
  onReplace: (stop: { stopRef: string; name: string }) => void;
  /** Where you are: not editable, no grip (the replan start). */
  fixed?: boolean;
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

/**
 * A station on the line. Tap its name to edit it in place: type another station, clear it and
 * leave the field to remove it, or set the stay beside it. The grip moves it.
 */
export function StopRow(p: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const head = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const { w } = p;
  const inner = w.kind !== 'start' && w.kind !== 'end';
  const off = w.kind === 'stop' || w.kind === 'turnaround';
  const stay = off ? w.dwellMin : 0;
  const stays = [...new Set([0, ...DWELLS, stay])].sort((a, b) => a - b);

  // Back on the name after editing, so keyboard users keep their place.
  useEffect(() => {
    if (!editing && wasEditing.current) head.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <li
      className={`stop ${p.fixed ? 'fixed' : ''} ${w.kind === 'via' ? 'via' : ''} ${p.last ? 'last' : ''} ${p.dragging ? 'dragging' : ''} ${editing ? 'editing' : ''}`}
      style={p.style}
    >
      <span className="dot" aria-hidden="true" />
      <div className="stop-top">
        {editing ? (
          <StopPicker
            label={t('changeTo', { name: w.name })}
            initial={w.name}
            autoFocus
            onPick={(s) => {
              setEditing(false);
              if (s.ref !== w.stopRef) p.onReplace({ stopRef: s.ref, name: s.name });
            }}
            onLeave={(text) => {
              setEditing(false);
              if (!text) p.onRemove();
            }}
            onCancel={() => setEditing(false)}
            trailing={
              inner && (
                <Select
                  className={`stay ${stay ? 'on' : ''}`}
                  label={t('stayLength', { name: w.name })}
                  value={String(stay)}
                  options={stays.map((m) => ({
                    value: String(m),
                    label: m === 0 ? t('rideThrough') : dwellLabel(m),
                  }))}
                  onChange={(v) => p.onStay(Number(v))}
                />
              )
            }
          />
        ) : (
          <button
            ref={head}
            type="button"
            className="stop-head"
            disabled={p.fixed}
            aria-description={p.fixed ? undefined : t('editHint')}
            onClick={() => setEditing(true)}
          >
            <span className="stop-name">
              <span>{w.name}</span>
              {p.caption && <small>{p.caption}</small>}
            </span>
            {off && w.dwellMin > 0 && <span className="dwell-tag">{dwellLabel(w.dwellMin)}</span>}
          </button>
        )}
        {!p.fixed && !editing && (
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
    </li>
  );
}
