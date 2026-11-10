// A platform beside a station's name (0.50.0): a platform is the station's, so it stands where
// you get off or board, not on the train. Under way the train's report wins, and a platform
// moved shows the planned one struck, as before on the ride.
import { platformAt } from '../core/live';
import type { RideRow } from '../core/rows';
import { useT } from '../store';
import { rideOf, type LiveCtx } from './lineLive';

export function StationPlatform({
  ride,
  side,
  live,
}: {
  /** The ride arrived with (`arr`) or boarded (`dep`). */
  ride: RideRow;
  side: 'arr' | 'dep';
  live: LiveCtx | undefined;
}) {
  const t = useT();
  const report = rideOf(live, ride)?.stops;
  const at =
    side === 'arr'
      ? platformAt(ride.section.to, report?.at(-1))
      : platformAt(ride.section.from, report?.[0]);
  if (!at.now) return null;
  const pl = (p: string) => t('platform', { p });
  if (at.moved)
    return (
      <span className="pl-at moved">
        <s aria-hidden="true">{pl(at.moved.was)}</s> <b aria-hidden="true">{pl(at.moved.now)}</b>
        <span className="sr-only">
          {t('platformChanged', { was: at.moved.was, p: at.moved.now })}
        </span>
      </span>
    );
  return <span className="pl-at">{pl(at.now)}</span>;
}
