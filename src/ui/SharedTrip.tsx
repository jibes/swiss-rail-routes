import { useEffect, useState } from 'react';
import { decodeTrip } from '../core/export/tripShare';
import { isPlanned, type PlannedTrip } from '../core/trip';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { ChainView } from './ChainView';
import { hhmm, longDate } from './format';
import { go } from './useHash';

/** `#/j/<data>`: a trip someone shared, as they planned it. Saving copies it to this device. */
export function SharedTrip({ hash }: { hash: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const add = useTrips((s) => s.add);
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

  if (trip === undefined) return <main className="page" />;
  if (!trip)
    return (
      <main className="page">
        <p role="alert">{t('sharedBroken')}</p>
        <button type="button" className="secondary" onClick={() => go('/')}>
          {t('back')}
        </button>
      </main>
    );
  return (
    <main className="page">
      <header className="hero">
        <h1>{trip.name || t('untitled')}</h1>
        <p>{t('sharedTrip')}</p>
      </header>
      <div className="summary">
        <span className="big">
          {hhmm(trip.chain.dep)} – {hhmm(trip.chain.arr)}
        </span>
        <span className="muted">{longDate(trip.route.date, lang)}</span>
      </div>
      <ChainView chain={trip.chain} dwell={trip.legs.map((l) => l.to.dwellMin)} />
      <div className="dock">
        <div className="dock-inner">
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
        </div>
      </div>
    </main>
  );
}
