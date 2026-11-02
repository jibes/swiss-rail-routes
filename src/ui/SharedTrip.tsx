import { useEffect, useState } from 'react';
import { decodeTrip } from '../core/export/tripShare';
import { dayOf, isPlanned, type PlannedTrip } from '../core/trip';
import { markRings, routeKey } from '../core/line';
import { useTours } from '../tours';
import { useNow } from './useNow';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { plannedRows } from '../core/rows';
import { TripFacts } from './TripFacts';
import { TripLine } from './TripLine';
import { longDate } from './format';
import { autoName } from '../core/naming';
import { go } from './useHash';
import { Icon } from './icons';
import { RailLoader } from './RailLoader';

/** `#/j/<data>`: a trip someone shared, as they planned it. Saving copies it to this device. */
export function SharedTrip({ hash }: { hash: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const add = useTrips((s) => s.add);
  const now = useNow();
  const [trip, setTrip] = useState<PlannedTrip | null | undefined>(undefined);

  useEffect(() => {
    let gone = false;
    decodeTrip(`#${hash}`, crypto.randomUUID()).then(
      (x) => !gone && setTrip(x && isPlanned(x) ? x : null),
    );
    return () => {
      gone = true;
    };
  }, [hash]);

  if (trip === undefined)
    return (
      <main className="page">
        <div className="hero-loading">
          <RailLoader label={t('opening')} />
        </div>
      </main>
    );
  if (!trip)
    return (
      <main className="page">
        <p role="alert">{t('sharedBroken')}</p>
        <button type="button" className="secondary" onClick={() => go('/')}>
          {t('back')}
        </button>
      </main>
    );
  const past = trip.route.date < dayOf(now);
  return (
    <main className="page trip-screen">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
      </header>
      <header className="hero">
        <h1>{trip.name || autoName(trip.route) || t('newTour')}</h1>
        <p>{t('sharedTrip')}</p>
      </header>
      <p className="eyebrow">{longDate(trip.route.date, lang)}</p>
      <TripFacts chain={trip.chain} />
      <TripLine
        route={trip.route}
        rows={plannedRows(trip.route, trip.chain.connections)}
        warnings={trip.chain.warnings}
        planning={false}
      />
      {past && <p className="notice">{t('sharedPast')}</p>}
      <div className="dock">
        <div className="dock-inner">
          {past ? (
            <button
              type="button"
              className="primary wide"
              onClick={() => {
                // Its day is over: kept as one of your trips (in search), to go again.
                const tour = {
                  ...trip.route,
                  id: `shared-${trip.id}`,
                  name: trip.name,
                  waypoints: markRings(trip.route.waypoints),
                };
                const key = routeKey(tour);
                const tours = useTours.getState().tours.filter((x) => routeKey(x) !== key);
                void useTours
                  .getState()
                  .replaceAll([tour, ...tours])
                  .catch(() => undefined);
                location.replace('#/');
              }}
            >
              {t('saveToYourTrips')}
            </button>
          ) : (
            <button
              type="button"
              className="primary wide"
              onClick={() => {
                // The same shared trip saved before: open it (no second copy, no double alerts).
                const same = useTrips
                  .getState()
                  .trips.find(
                    (x) =>
                      x.chain?.dep === trip.chain.dep &&
                      JSON.stringify(x.legs) === JSON.stringify(trip.legs),
                  );
                if (same) return location.replace(`#/trip/${same.id}`);
                add(trip);
                location.replace(`#/trip/${trip.id}`);
              }}
            >
              {t('saveToTrips')}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
