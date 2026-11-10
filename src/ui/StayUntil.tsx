// A stay until a date and time (0.44.0): for trips over several days, the next train leaves no
// earlier ("Kiruna until Monday 08:00"). Date and time as the trip's own fields; the cross takes
// it off (the stay is then its length again).
import { useT, usePrefs } from '../store';
import { shortDate } from './format';
import { Icon } from './icons';
import { WhenField } from './WhenField';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function StayUntil({
  name,
  value,
  day,
  set,
}: {
  name: string;
  /** `YYYY-MM-DDTHH:MM`, or none. */
  value: string | undefined;
  /** The day it starts from when only a time is chosen (the trip's). */
  day: string;
  set: (until: string | null) => void;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const date = value?.slice(0, 10) ?? '';
  const time = value?.slice(11, 16) ?? '';
  return (
    <div className="stay-until">
      <WhenField
        type="date"
        label={t('stayUntilDateLabel', { name })}
        value={date}
        min={day}
        accept={(d) => (DATE.test(d) && d >= day ? d : null)}
        commit={(d) => set(`${d}T${time || '08:00'}`)}
      >
        {(d) => (
          <>
            <Icon name="calendar" size={18} />
            {t('stayUntilPill')} {d ? shortDate(d, lang) : t('leaveByNone')}
          </>
        )}
      </WhenField>
      {value && (
        <WhenField
          type="time"
          label={t('stayUntilTimeLabel', { name })}
          value={time}
          accept={(hm) => (TIME.test(hm) ? hm : null)}
          commit={(hm) => set(`${date || day}T${hm}`)}
        >
          {(hm) => (
            <>
              <Icon name="clock" size={18} />
              {hm}
            </>
          )}
        </WhenField>
      )}
      {value && (
        <button
          type="button"
          className="icon"
          aria-label={t('stayUntilClear', { name })}
          onClick={() => set(null)}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
