import { useEffect } from 'react';
import { expectedArrival } from '../core/live';
import { autoName } from '../core/naming';
import { stopKey } from '../core/stops';
import { dayOf, departure, newTrip, sortTrips, tripStatus, type Trip } from '../core/trip';
import { newTour } from '../core/edit';
import { usePrefs, useT } from '../store';
import { defaultDate } from '../tours';
import { useTrips } from '../trips';
import { duration, hhmm, minutesBetween, nextHalfHour } from './format';
import { Icon } from './icons';
import { LiveBar } from './LiveBar';
import { Logo } from './Logo';
import { MiniLine } from './MiniLine';
import { go } from './useHash';
import { useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';
import { forgetDeleted, useDeleted } from './undoDelete';

/** A trip on the list: its day, name, line and times. */
function Card({
  trip,
  live,
  stop,
}: {
  trip: Trip;
  live: boolean;
  stop: Parameters<typeof autoName>[1];
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const d = new Date(`${trip.route.date}T12:00:00Z`);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(d);
  const c = trip.chain;
  return (
    <li>
      <a href={`#/trip/${trip.id}`} className={`card ${live ? 'live' : ''}`}>
        <span className="day" aria-hidden="true">
          <b>{d.getUTCDate()}</b>
          <i>{fmt({ weekday: 'short' })}</i>
          <i>{fmt({ month: 'short' })}</i>
        </span>
        <span className="cbody">
          <span className="name">{trip.name || autoName(trip.route, stop) || t('newTour')}</span>
          {trip.route.waypoints.length > 1 && <MiniLine tour={trip.route} />}
          <span className="sub num">
            <span className="sr-only">
              {fmt({ weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            </span>
            {live && <em>{t('liveNow')} · </em>}
            {c
              ? `${hhmm(c.dep)} – ${hhmm(c.arr)} · ${duration(minutesBetween(c.dep, c.arr))}`
              : trip.route.waypoints.length > 1
                ? t('notPlanned')
                : t('addStations')}
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * The one list (SPEC §3a, 0.4.0): every trip has a date; under way first, then coming up. A trip
 * whose day is over waits in search (New trip → your trips).
 */
export function Home() {
  const t = useT();
  const trips = useTrips((s) => s.trips);
  const add = useTrips((s) => s.add);
  const remove = useTrips((s) => s.remove);
  const deleted = useDeleted((s) => s.trip);
  const liveStatus = useLiveStatus((s) => s.status);
  const now = useNow();
  const index = useStopIndex();
  const stop = (r: string) => index?.byRef(stopKey(r));
  // "New trip" and then Back leaves an empty trip: tidy it away on coming back.
  useEffect(() => {
    for (const x of useTrips.getState().trips) if (!x.route.waypoints.length) remove(x.id);
  }, [remove]);
  const arrivalOf = (x: Trip) =>
    x.chain ? expectedArrival(x.chain.connections, liveStatus) : undefined;
  const { current, past } = sortTrips(trips, now, arrivalOf);
  // Over today: kept here, read-only, until the day ends (then they wait in search).
  const doneToday = past.filter((x) => x.route.date === dayOf(now));
  const live = current.filter((x) => tripStatus(x, now, arrivalOf(x)) === 'live');
  const ahead = current
    .filter((x) => !live.includes(x))
    .sort((a, b) => departure(a) - departure(b));

  return (
    <main className="page home">
      <LiveBar />
      <div className="brand">
        <Logo />
        <span>{t('appName')}</span>
      </div>
      <h1 className="h1">
        {ahead.length
          ? t('tripsAhead', { n: ahead.length })
          : live.length
            ? t('underWay')
            : t('nothingPlanned')}
      </h1>
      {!current.length && <p className="muted empty">{t('noTripsYet')}</p>}
      {live.length > 0 && (
        <section>
          <h2 className="section-label">{t('nowSection')}</h2>
          <ul className="cards">
            {live.map((x) => (
              <Card key={x.id} trip={x} live stop={stop} />
            ))}
          </ul>
        </section>
      )}
      {ahead.length > 0 && (
        <section>
          <h2 className="section-label">{t('upcoming')}</h2>
          <ul className="cards" aria-label={t('upcoming')}>
            {ahead.map((x) => (
              <Card key={x.id} trip={x} live={false} stop={stop} />
            ))}
          </ul>
        </section>
      )}

      {deleted && (
        <div className="toast" role="status">
          <span>
            {t('tripDeleted', {
              name: deleted.name || autoName(deleted.route, stop) || t('newTour'),
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              add(deleted);
              forgetDeleted();
            }}
          >
            {t('undo')}
          </button>
        </div>
      )}

      {doneToday.length > 0 && (
        <section>
          <h2 className="section-label">{t('doneTodaySection')}</h2>
          <ul className="cards done" aria-label={t('doneTodaySection')}>
            {doneToday.map((x) => (
              <Card key={x.id} trip={x} live={false} stop={stop} />
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
            className="primary wide"
            onClick={() => {
              const id = crypto.randomUUID();
              // On a Saturday that is today: from the next half hour, not from 08:00 gone by.
              const date = defaultDate();
              const tour = newTour(id, date);
              if (date === dayOf(Date.now()) && nextHalfHour(Date.now()) > '08:00')
                tour.anchor = { departAt: nextHalfHour(Date.now()) };
              add(newTrip(id, tour, undefined, undefined, new Date()));
              go(`/trip/${id}`);
            }}
          >
            <Icon name="plus" />
            {t('newTour')}
          </button>
        </div>
      </div>
    </main>
  );
}
