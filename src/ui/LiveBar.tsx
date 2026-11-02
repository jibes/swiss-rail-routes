import { expectedArrival, liveState } from '../core/live';
import { autoName } from '../core/naming';
import { isPlanned, liveTrip } from '../core/trip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { badge } from './format';
import { hhmm } from './format';
import { useLiveStatus } from './useLive';
import { useNow } from './useNow';

/** On the lists while a trip is under way: its next step, one tap to "Now". */
export function LiveBar() {
  const t = useT();
  const now = useNow();
  const trips = useTrips((s) => s.trips);
  // The same live data as the trip screen: delays, new platforms, a late last train.
  const status = useLiveStatus((s) => s.status);
  const trip = liveTrip(trips.filter(isPlanned), now, (x) =>
    x.chain ? expectedArrival(x.chain.connections, status) : undefined,
  );
  if (!trip || !isPlanned(trip)) return null;
  const s = liveState(trip.chain.connections, now, status);
  const n = s.next;
  const ride = n ? s.rides[n.ride] : undefined;
  return (
    <a className="livebar" href={`#/trip/${trip.id}`}>
      <span className="live-tag">{t('liveNow')}</span>
      <span className="livebar-text">
        {n && ride
          ? n.kind === 'board'
            ? `${badge(ride.s)} ${hhmm(n.at)}${n.stop.platform ? ` · ${t('platform', { p: n.stop.platform })}` : ''}`
            : `${t('nowAlight', { stop: n.stop.name })} ${hhmm(n.at)}`
          : trip.name || autoName(trip.route)}
      </span>
    </a>
  );
}
