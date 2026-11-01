import { sortTrips, tripStatus, type Trip } from '../core/trip';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { hhmm, longDate } from './format';
import { MiniLine } from './Home';
import { TabBar } from './TabBar';
import { useNow } from './useNow';

function TripCard({ trip, now }: { trip: Trip; now: number }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const live = tripStatus(trip, now) === 'live';
  return (
    <li>
      <a
        href={`#/trip/${trip.id}${live ? '/now' : ''}`}
        className={`tour-card ${live ? 'is-live' : ''}`}
      >
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

export function Trips() {
  const t = useT();
  const trips = useTrips((s) => s.trips);
  const now = useNow();
  const { current, past } = sortTrips(trips, now);
  return (
    <main className="page with-tabs">
      <header className="hero">
        <h1>{t('trips')}</h1>
      </header>
      {trips.length === 0 && <p className="empty">{t('noTrips')}</p>}
      {current.length > 0 && (
        <ul className="tours" aria-label={t('upcoming')}>
          {current.map((x) => (
            <TripCard key={x.id} trip={x} now={now} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <>
          <h2 className="section-label">{t('past')}</h2>
          <ul className="tours past" aria-label={t('past')}>
            {past.map((x) => (
              <TripCard key={x.id} trip={x} now={now} />
            ))}
          </ul>
        </>
      )}
      <TabBar />
    </main>
  );
}
