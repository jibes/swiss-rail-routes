import type { PlanResult } from '../core/planner/plan';
import { usePrefs, useT } from '../store';
import { RailLoader } from './RailLoader';

export type PlanState = 'planning' | 'done' | 'error' | 'unavailable';

/**
 * What the planner has to say above the options, the same on the trip screen and in Replan:
 * planning, planning off, a failure in plain words with Retry, a leg without a connection, a
 * leg planned without its stations or line, reservation trains left out when that may be why. Stations not reached show on the line itself.
 */
export function PlanNotices({
  state,
  detail,
  result,
  retry,
}: {
  state: PlanState;
  /** The error's own text, only to choose the plain words. */
  detail: string;
  result: PlanResult | null;
  retry: () => void;
}) {
  const t = useT();
  const never = usePrefs((s) => s.reservations) === 'never';
  const leg = (i: number) => ({
    from: result?.legs?.[i]?.from.name ?? '',
    to: result?.legs?.[i]?.to.name ?? '',
  });
  return (
    <>
      {state === 'planning' && (
        <div className="hero-loading" role="status">
          <RailLoader />
          <span className="muted">{t('planning')}</span>
        </div>
      )}
      {state === 'unavailable' && (
        <p role="status" className="notice">
          {t('planUnavailable')}
        </p>
      )}
      {state === 'error' && (
        <div role="alert" className="notice red">
          <span>
            {/fetch|network|TypeError|Abort|Timeout/i.test(detail)
              ? t('planOffline')
              : /^5\d\d/.test(detail)
                ? t('planServer')
                : t('planFailed')}
          </span>
          <button type="button" className="secondary small" onClick={retry}>
            {t('retry')}
          </button>
        </div>
      )}
      {result?.failedLeg !== undefined && (
        <p role="alert" className="notice red">
          <span>{t('legFailed', { n: result.failedLeg + 1, ...leg(result.failedLeg) })}</span>
        </p>
      )}
      {result?.relaxed.map((r, i) => (
        <p key={i} className="notice">
          {t('relaxedLeg', leg(r.legIndex))}
        </p>
      ))}
      {never &&
        state === 'done' &&
        result &&
        (!result.options?.length || result.relaxed.length > 0) && (
          <p className="notice">{t('reservationsLeftOut')}</p>
        )}
    </>
  );
}
