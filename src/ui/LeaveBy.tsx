// A stay's time to leave by (0.20.0): the place closes. The native time field over a pill, as
// the trip's own time; empty is any time, the cross takes it off.
import { useT } from '../store';
import { Icon } from './icons';
import { WhenField } from './WhenField';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function LeaveBy({
  name,
  value,
  set,
}: {
  name: string;
  value: string | undefined;
  set: (hm: string | null) => void;
}) {
  const t = useT();
  return (
    <div className="leave-by">
      <WhenField
        type="time"
        label={t('leaveByLabel', { name })}
        value={value ?? ''}
        accept={(hm) => (TIME.test(hm) ? hm : null)}
        commit={(hm) => set(hm)}
      >
        {(hm) => (
          <>
            <Icon name="clock" size={18} />
            {t('leaveBy')} {hm || t('leaveByNone')}
          </>
        )}
      </WhenField>
      {value && (
        <button
          type="button"
          className="icon"
          aria-label={t('leaveByClear', { name })}
          onClick={() => set(null)}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
