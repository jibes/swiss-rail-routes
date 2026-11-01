import { expectedArrival } from '../core/live';
import { tripStatus, type Trip } from '../core/trip';
import { usePrefs, useT } from '../store';
import { hhmm, longDate } from './format';
import { MiniLine } from './Home';
import { useLiveStatus } from './useLive';

/** A trip as a card: name (and "live" while under way), its line, date and times. */
export function TripCard({ trip, now }: { trip: Trip; now: number }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const status = useLiveStatus((s) => s.status);
  const live = tripStatus(trip, now, expectedArrival(trip.chain.connections, status)) === 'live';
  return (
    <li>
      <a href={`#/trip/${trip.id}`} className={`tour-card ${live ? 'is-live' : ''}`}>
        <strong>
          {trip.name || t('untitled')}
          {live && <span className="live-tag">{t('liveNow')}</span>}
        </strong>
        <MiniLine tour={trip.route} />
        <span className="meta num">
          {longDate(trip.route.date, lang)} · {hhmm(trip.chain.dep)}–{hhmm(trip.chain.arr)}
        </span>
      </a>
    </li>
  );
}
