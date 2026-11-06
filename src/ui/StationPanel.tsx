// A station of yours, opened (from TripLine.tsx): its name, ride through or stay (how long, and
// by when), its scenic line, add after, up, down, remove; a pinned via says so and unpins.
import { useT } from '../store';
import { Icon } from './icons';
import { LeaveBy } from './LeaveBy';
import type { FindSubstitute } from './MissedNote';

export interface LineActions {
  /** Entry `k` replaced by another station (a station missed: the nearest that works, Use). */
  replace: (k: number, stop: { stopRef: string; name: string }) => void;
  stay: (k: number, min: number | null) => void;
  /** A stay's time to leave by (the place closes), or any time. */
  leaveBy?: (k: number, hhmm: string | null) => void;
  move: (from: number, to: number) => void;
  remove: (k: number) => void;
  dropLine: (k: number) => void;
  addAfter: (k: number) => void;
  add: () => void;
  /** An hour later (a station not reached may be at another time). */
  later: () => void;
  /** The nearest station that works in place of entry `k` (a tap on a station missed). */
  find?: FindSubstitute;
  /** A station the plan chose made yours, after entry `k`: a via; with a stay; or adding on. */
  pin?: (k: number, stop: { stopRef: string; name: string }, then?: 'stay' | 'add') => void;
}

/** A stay goes up and down in quarter hours; any length can be typed (to 10 h). */
const STAY_STEP = 15;
const STAY_MAX = 600;
const clampStay = (m: number) => Math.min(STAY_MAX, Math.max(1, Math.round(m)));

export function StationPanel({
  k,
  n,
  fixed,
  name,
  stay,
  leaveBy,
  line,
  change,
  act,
  close,
  pinnedHere,
}: {
  /** A pinned via (TripLine's pinnedAt): neither renamed nor moved. */
  pinnedHere?: boolean;
  /** You asked to ride through, but the plan changes trains here. */
  change: boolean;
  k: number;
  n: number;
  /** How many stations at the start stay where they are (replan: the one you are at). */
  fixed: number;
  name: string;
  stay: number | null;
  leaveBy?: string;
  line: string;
  act: LineActions;
  close: () => void;
}) {
  const t = useT();
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
  // A via between your first and last station is pinned: the plan must pass it, where the
  // train does. So it is neither renamed nor moved: unpin it, or stay there.
  const pinned = !!pinnedHere;
  return (
    <div className="panel">
      {/* The name, not a field (0.35.1: another station is added and this one removed); a pinned
          via says so by its pin. The cross closes the panel. */}
      <div className="panel-head">
        <p className="panel-name">
          <span>{name}</span>
          {pinned && (
            <>
              <Icon name="pin" size={16} />
              <span className="muted">{t('pinnedVia')}</span>
            </>
          )}
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
              onClick={() => !stay && act.stay(k, 30)}
            >
              {t('stayHere')}
            </button>
          </div>
          {stay === null && change && <p className="panel-note">{t('changeNeeded')}</p>}
          {!!stay && <StayStepper k={k} name={name} stay={stay} act={act} />}
          {!!stay && act.leaveBy && (
            <LeaveBy name={name} value={leaveBy} set={(hm) => act.leaveBy!(k, hm)} />
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
        {!pinned && (
          <>
            <button
              type="button"
              className="sq"
              aria-label={t('moveUp', { name })}
              disabled={k <= fixed}
              onClick={() => act.move(k, k - 1)}
            >
              <Icon name="up" size={18} />
            </button>
            <button
              type="button"
              className="sq"
              aria-label={t('moveDown', { name })}
              disabled={k === n - 1}
              onClick={() => act.move(k, k + 1)}
            >
              <Icon name="down" size={18} />
            </button>
          </>
        )}
        <span className="sp" />
        {n > 1 &&
          (pinned ? (
            // The action in words: the pin by the name is the state.
            <button
              type="button"
              className="pill unpin"
              aria-label={t('unpin', { stop: name })}
              onClick={() => act.remove(k)}
            >
              <Icon name="pin" size={16} />
              {t('unpinAction')}
            </button>
          ) : (
            <button
              type="button"
              className="sq danger"
              aria-label={t('removeStation', { stop: name })}
              onClick={() => act.remove(k)}
            >
              <Icon name="trash" size={18} />
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * How long to stay: a quarter hour less or more, or the number typed (tap it). Saved when the
 * typing ends (Enter, leaving the field), not on every key: each change plans again.
 */
function StayStepper({
  k,
  name,
  stay,
  act,
}: {
  k: number;
  name: string;
  stay: number;
  act: LineActions;
}) {
  const t = useT();
  const commit = (v: string) => {
    const m = Number(v);
    if (v.trim() && Number.isFinite(m) && m > 0 && clampStay(m) !== stay) act.stay(k, clampStay(m));
  };
  return (
    <div className="stepper" role="group" aria-label={t('stayAtStop', { stop: name })}>
      <button
        type="button"
        className="sq"
        aria-label={t('stayShorter', { n: STAY_STEP })}
        disabled={stay <= STAY_STEP}
        onClick={() => act.stay(k, clampStay(stay - STAY_STEP))}
      >
        <Icon name="minus" size={18} />
      </button>
      <label className="stay-input">
        <input
          // A new value from the buttons replaces what was typed.
          key={stay}
          type="number"
          inputMode="numeric"
          min={1}
          max={STAY_MAX}
          defaultValue={stay}
          aria-label={t('stayMinutes', { stop: name })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span aria-hidden="true">{t('minUnit')}</span>
      </label>
      <button
        type="button"
        className="sq"
        aria-label={t('stayLonger', { n: STAY_STEP })}
        disabled={stay >= STAY_MAX}
        onClick={() => act.stay(k, clampStay(stay + STAY_STEP))}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
