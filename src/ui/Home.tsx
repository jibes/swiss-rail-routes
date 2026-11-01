import { useEffect } from 'react';
import type { Tour } from '../core/model';
import { isRoundTrip, totalDwellMin } from '../core/tour';
import { useT } from '../store';
import { madeHere, useTours } from '../tours';
import { dwellLabel } from './StopRow';
import { Icon } from './icons';
import { LiveBar } from './LiveBar';
import { TripCard } from './TripCard';
import { useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { expectedArrival } from '../core/live';
import { sortTrips } from '../core/trip';
import { useTrips } from '../trips';
import { go } from './useHash';
import { useStopIndex } from './useStopIndex';
import { autoName } from '../core/naming';
import { stopKey } from '../core/stops';

/** The tour drawn as a tiny line: solid dots where you get off, rings where you ride through. */
export function MiniLine({ tour }: { tour: Tour }) {
  const pts = tour.waypoints;
  return (
    <span className="mini-line" aria-hidden="true">
      {pts.map((w, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <i />}
          <b className={w.kind === 'via' ? 'via' : ''} />
        </span>
      ))}
    </span>
  );
}

function EmptyLine() {
  return (
    <svg width="160" height="40" viewBox="0 0 160 40" aria-hidden="true">
      <path d="M12 20h136" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="20" r="7" fill="currentColor" />
      <circle cx="62" cy="20" r="5" fill="var(--bg)" stroke="currentColor" strokeWidth="2" />
      <circle cx="104" cy="20" r="5" fill="var(--bg)" stroke="currentColor" strokeWidth="2" />
      <circle cx="148" cy="20" r="7" fill="currentColor" />
    </svg>
  );
}

/** An idea as a card: its line, where it goes, how long the stays add up to. */
function IdeaCard({ tour, stop }: { tour: Tour; stop: Parameters<typeof autoName>[1] }) {
  const t = useT();
  const first = tour.waypoints[0]?.name;
  const last = tour.waypoints.at(-1)?.name;
  const route = !first
    ? ''
    : isRoundTrip(tour)
      ? `${first} ↺`
      : last && last !== first
        ? `${first} → ${last}`
        : first;
  return (
    <li>
      <a href={`#/tour/${tour.id}`} className="tour-card idea">
        <strong>{tour.name || autoName(tour, stop) || t('untitled')}</strong>
        {tour.waypoints.length > 1 && <MiniLine tour={tour} />}
        <span className="meta">
          {route}
          {totalDwellMin(tour) > 0 && ` · ${t('staysFor', { d: dwellLabel(totalDwellMin(tour)) })}`}
        </span>
      </a>
    </li>
  );
}

/**
 * The one list (SPEC §3a): a trip is an idea until it is planned. Upcoming trips (the one
 * under way first), ideas (no timetable yet), past trips.
 */
export function Home() {
  const t = useT();
  const tours = useTours((s) => s.tours);
  const trips = useTrips((s) => s.trips);
  const liveStatus = useLiveStatus((s) => s.status);
  const now = useNow();
  const removeTour = useTours((s) => s.remove);
  // "New trip" and then Back leaves an empty idea: tidy it away on coming back (only one this
  // device made, with neither a station nor a name).
  useEffect(() => {
    for (const x of useTours.getState().tours)
      if (madeHere.has(x.id) && !x.waypoints.length && !x.name.trim()) removeTour(x.id);
  }, [removeTour]);
  const create = useTours((s) => s.create);
  const index = useStopIndex();
  const stop = (r: string) => index?.byRef(stopKey(r));
  const { current, past } = sortTrips(trips, now, (x) =>
    expectedArrival(x.chain.connections, liveStatus),
  );

  return (
    <main className="page home">
      <LiveBar />
      <header className="hero">
        <h1>{t('trips')}</h1>
        <p>{t('tagline')}</p>
      </header>

      {!tours.length && !trips.length && (
        <div className="empty">
          <EmptyLine />
          <p>{t('noTours')}</p>
        </div>
      )}
      {current.length > 0 && (
        <section>
          <h2 className="section-label">{t('upcoming')}</h2>
          <ul className="tours" aria-label={t('upcoming')}>
            {current.map((x) => (
              <TripCard key={x.id} trip={x} now={now} />
            ))}
          </ul>
        </section>
      )}
      {tours.length > 0 && (
        <section>
          <h2 className="section-label">{t('savedTours')}</h2>
          <ul className="tours" aria-label={t('savedTours')}>
            {tours.map((x) => (
              <IdeaCard key={x.id} tour={x} stop={stop} />
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h2 className="section-label">{t('past')}</h2>
          <ul className="tours past" aria-label={t('past')}>
            {past.map((x) => (
              <TripCard key={x.id} trip={x} now={now} />
            ))}
          </ul>
        </section>
      )}

      <footer className="home-foot">
        <a className="settings-link" href="#/settings">
          <Icon name="gear" size={18} />
          {t('settings')}
        </a>
        <span>{t('build', { sha: __BUILD__.sha })}</span>
      </footer>

      <div className="dock">
        <div className="dock-inner">
          <button
            type="button"
            className="secondary"
            onClick={() => go(`/tour/${create()}/templates`)}
          >
            {t('fromTemplate')}
          </button>
          <button type="button" className="primary wide" onClick={() => go(`/tour/${create()}`)}>
            <Icon name="plus" />
            {t('newTour')}
          </button>
        </div>
      </div>
    </main>
  );
}
