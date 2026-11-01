import { liveState } from '../core/live';
import { liveTrip } from '../core/trip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { badge } from './ChainView';
import { hhmm } from './format';
import { useNow } from './useNow';

/** On the lists while a trip is under way: its next step, one tap to "Now". */
export function LiveBar() {
  const t = useT();
  const now = useNow();
  const trip = useTrips((s) => liveTrip(s.trips, now));
  if (!trip) return null;
  const s = liveState(trip.chain.connections, now);
  const n = s.next;
  const ride = n ? s.rides[n.ride] : undefined;
  return (
    <a className="livebar" href={`#/trip/${trip.id}`}>
      <span className="live-tag">{t('liveNow')}</span>
      <span className="livebar-text">
        {n && ride
          ? n.kind === 'board'
            ? `${badge(ride.s)} ${hhmm(n.at)}${n.stop.platform ? ` · ${t('platform', { p: n.stop.platform })}` : ''}`
            : t('nowAlight', { stop: n.stop.name }) + ` ${hhmm(n.at)}`
          : trip.name}
      </span>
    </a>
  );
}
