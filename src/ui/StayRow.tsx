// A stay as one row (0.51.0): − 90 min + until 16:30 (and its day, when not the arrival's).
// Each is filled from the other by the plan's arrival; the one edited last is kept: a length
// stays a length when the plan moves, a time stays that time.
import { useState } from 'react';
import { shiftUntil, stayEnd, stayLength, untilAt } from '../core/stay';
import { usePrefs, useT } from '../store';
import { shortDate } from './format';
import { Icon } from './icons';
import type { LineActions } from './StationPanel';
import { WhenField } from './WhenField';

/** A stay goes up and down in quarter hours; any length can be typed (to 10 h). */
const STAY_STEP = 15;
const STAY_MAX = 600;
const clampStay = (m: number) => Math.min(STAY_MAX, Math.max(1, Math.round(m)));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function StayRow({
  k,
  name,
  stay,
  until,
  arr,
  day,
  act,
}: {
  k: number;
  name: string;
  stay: number;
  /** `YYYY-MM-DDTHH:MM`: the stay ends at a time (kept), else it lasts `stay` minutes. */
  until: string | undefined;
  /** The plan's arrival here (ISO), none before it is planned. */
  arr: string | undefined;
  /** The trip's day. */
  day: string;
  act: LineActions;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const length = stayLength(arr, stay, until);
  const end = stayEnd(arr, stay, until);
  const arrDay = (arr && stayEnd(arr, 0, undefined)?.slice(0, 10)) || day;
  const endDay = end?.slice(0, 10) ?? arrDay;
  const setUntil = act.stayUntil;
  // A long stay until a time (another day) moves by its time: its length is past the stepper's.
  const step = (d: number) => {
    if (length === undefined) return;
    if (until && setUntil && length + Math.max(d, 0) > STAY_MAX) setUntil(k, shiftUntil(until, d));
    else act.stay(k, clampStay(length + d));
  };
  // What is typed, held while the field has focus: a plan coming in meanwhile changes nothing.
  const [draft, setDraft] = useState<string | null>(null);
  // Only a length typed that differs is kept: tabbing through leaves a stay until a time as it is.
  const commit = (v: string) => {
    setDraft(null);
    const m = Number(v);
    if (v.trim() && Number.isFinite(m) && m > 0 && clampStay(m) !== length)
      act.stay(k, clampStay(m));
  };
  return (
    <div className="stay-row" role="group" aria-label={t('stayAtStop', { stop: name })}>
      <div className={`stepper ${until ? 'derived' : ''}`}>
        <button
          type="button"
          className="sq"
          aria-label={t('stayShorter', { n: STAY_STEP })}
          disabled={length === undefined || length <= STAY_STEP}
          onClick={() => step(-STAY_STEP)}
        >
          <Icon name="minus" size={18} />
        </button>
        <label className="stay-input">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={draft ?? length ?? ''}
            placeholder="–"
            aria-label={t('stayMinutes', { stop: name })}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onFocus={(e) => {
              setDraft(String(length ?? ''));
              e.currentTarget.select();
            }}
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
          disabled={length === undefined || (!until && length >= STAY_MAX)}
          onClick={() => step(STAY_STEP)}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>
      {setUntil && (
        <div className={`stay-end ${until ? '' : 'derived'}`}>
          <span className="muted">{t('stayUntilWord')}</span>
          <WhenField
            type="time"
            label={t('stayUntilTimeLabel', { name })}
            value={end?.slice(11, 16) ?? ''}
            accept={(hm) => (TIME.test(hm) ? hm : null)}
            commit={(hm) => setUntil(k, untilAt(hm, arr, day, until))}
          >
            {(hm) => hm || '––:––'}
          </WhenField>
          {/* Its day, said only when not the arrival's (across midnight, several days). */}
          <WhenField
            type="date"
            label={t('stayUntilDateLabel', { name })}
            value={endDay}
            min={arrDay}
            accept={(d) => (DATE.test(d) && d >= arrDay ? d : null)}
            commit={(d) => setUntil(k, `${d}T${end?.slice(11, 16) ?? '08:00'}`)}
          >
            {(d) => (
              <>
                <Icon name="calendar" size={18} />
                {d !== arrDay && shortDate(d, lang)}
              </>
            )}
          </WhenField>
        </div>
      )}
    </div>
  );
}
