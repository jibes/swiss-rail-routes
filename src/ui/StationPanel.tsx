// A station of yours, opened (from TripLine.tsx): its name, ride through or stay (how long, or
// until when: one row, StayRow.tsx), its scenic line, add after, up, down, remove.
import { DEFAULT_STAY } from '../core/line';
import { useEffect, useRef } from 'react';
import { useT } from '../store';
import { Icon } from './icons';
import { StayRow } from './StayRow';

export interface LineActions {
  /** Entry `k` replaced by another station (a station missed: the nearest that works, Use). */
  replace: (k: number, stop: { stopRef: string; name: string }) => void;
  stay: (k: number, min: number | null) => void;
  /** A stay until a date and time (kept over its length), or as long as its length (null). */
  stayUntil?: (k: number, until: string | null) => void;
  move: (from: number, to: number) => void;
  remove: (k: number) => void;
  dropLine: (k: number) => void;
  addAfter: (k: number) => void;
  add: () => void;
  /** An hour later (a station not reached may be at another time). */
  later: () => void;
  /** The nearest station that works in place of entry `k` (a tap on a station missed). */
  /** A station the plan chose made yours, after entry `k`: a via; with a stay; or adding on. */
  /** A station the plan chose, kept: one of yours after entry `k`. */
  pin?: (k: number, stop: { stopRef: string; name: string }) => void;
}

/**
 * Moved up or down, the panel opens again under the station's new place: focus goes to the same
 * button there, so the keyboard can move it on (review of 11 Nov 2026: it fell to the page).
 */
let refocus: 'up' | 'down' | null = null;

export function StationPanel({
  k,
  n,
  fixed,
  name,
  stay,
  stayUntil,
  arr,
  dep,
  day,
  line,
  change,
  act,
  close,
}: {
  /** You asked to ride through, but the plan changes trains here. */
  change: boolean;
  k: number;
  n: number;
  /** How many stations at the start stay where they are (replan: the one you are at). */
  fixed: number;
  name: string;
  stay: number | null;
  stayUntil?: string;
  /** The plan's arrival here (ISO): a stay's length and end each said from the other. */
  arr?: string;
  /** The plan's departure from here (ISO): the next train, said when well after the stay. */
  dep?: string;
  /** The trip's day: a stay until starts from it. */
  day: string;
  line: string;
  act: LineActions;
  close: () => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!refocus) return;
    const b = box.current?.querySelector<HTMLButtonElement>(`[data-move="${refocus}"]`);
    refocus = null;
    // Else the panel's first control (at an end, one of up and down is off).
    (b && !b.disabled
      ? b
      : box.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
    )?.focus();
  }, []);
  const inner = k > 0 && k < n - 1;
  const closeButton = (
    <button type="button" className="icon" aria-label={t('close')} onClick={close}>
      <Icon name="close" size={18} />
    </button>
  );
  if (k < fixed)
    return (
      <div className="panel">
        <div className="acts">
          <button type="button" className="pill" onClick={() => act.addAfter(k)}>
            <Icon name="plus" size={16} />
            {t('addAfter')}
          </button>
          <span className="sp" />
          {closeButton}
        </div>
      </div>
    );
  return (
    <div className="panel" ref={box}>
      {/* The name, not a field (0.35.1: another station is added and this one removed). The
          cross closes the panel. */}
      <div className="panel-head">
        <p className="panel-name">
          <span>{name}</span>
        </p>
        {closeButton}
      </div>
      {inner && (
        <>
          {/* Ride through (changing if the timetable needs it), or stay (for how long below). A
              stop of 0 min (a replan's, an older trip's) has no stay: it reads as no stop. */}
          <div className="chips seg" role="group" aria-label={t('atThisStation')}>
            <button
              type="button"
              className={`pill ${!stay ? 'on' : ''}`}
              aria-pressed={!stay}
              onClick={() => stay !== null && act.stay(k, null)}
            >
              {t('noStop')}
            </button>
            <button
              type="button"
              className={`pill ${stay ? 'on' : ''}`}
              aria-pressed={!!stay}
              onClick={() => !stay && act.stay(k, DEFAULT_STAY)}
            >
              {t('stayHere')}
            </button>
          </div>
          {stay === null && change && <p className="panel-note">{t('changeNeeded')}</p>}
          {!!stay && (
            <StayRow
              k={k}
              name={name}
              stay={stay}
              until={stayUntil}
              arr={arr}
              dep={dep}
              day={day}
              act={act}
            />
          )}
        </>
      )}
      {line && (
        <div className="chips">
          <span className="pill via-line">
            {t('viaLine', { line })}
            <button
              type="button"
              aria-label={t('withoutLine', { line })}
              onClick={() => act.dropLine(k)}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        </div>
      )}
      <button type="button" className="pill add-after" onClick={() => act.addAfter(k)}>
        <Icon name="plus" size={16} />
        {t('addAfter')}
      </button>
      <div className="acts">
        <button
          type="button"
          className="sq"
          aria-label={t('moveUp', { name })}
          data-move="up"
          disabled={k <= fixed}
          onClick={() => {
            refocus = 'up';
            act.move(k, k - 1);
          }}
        >
          <Icon name="up" size={18} />
        </button>
        <button
          type="button"
          className="sq"
          aria-label={t('moveDown', { name })}
          data-move="down"
          disabled={k === n - 1}
          onClick={() => {
            refocus = 'down';
            act.move(k, k + 1);
          }}
        >
          <Icon name="down" size={18} />
        </button>
        <span className="sp" />
        {n > 1 && (
          <button
            type="button"
            className="sq danger"
            aria-label={t('removeStation', { stop: name })}
            onClick={() => act.remove(k)}
          >
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
