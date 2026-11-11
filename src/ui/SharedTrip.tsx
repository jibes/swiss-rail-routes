import { useEffect, useRef, useState } from 'react';
import { decodeTripLink } from '../core/export/tripLink';
import { decodeTrip } from '../core/export/tripShare';
import { linkWarnings, reloadTrip, stopNames } from '../io/refresh';
import { PullReload, saidOf, useReload } from './PullReload';
import { compactTrip, dayOf, isPlanned, type PlannedTrip } from '../core/trip';
import { lineName } from './TemplatePicker';
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

/**
 * `#/s/<data>` (its trains; the rest comes fresh) or `#/j/<data>` (older: all of it): a trip
 * someone shared. Saving copies it to this device, and what arrives after that goes with it.
 */
export function SharedTrip({ hash }: { hash: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const add = useTrips((s) => s.add);
  const [trip, setTrip] = useState<PlannedTrip | null | undefined>(undefined);
  const [bare, setBare] = useState(false);
  const shown = useRef<PlannedTrip | null>(null);
  const saved = useRef<string | null>(null);
  const update = useTrips((s) => s.update);

  const { busy, said, reload } = useReload(async () => {
    const was = shown.current;
    if (!was) return null;
    const r = await reloadTrip(was);
    if (r.found || r.gone) {
      const chain = compactTrip({ ...was, chain: r.chain, compact: undefined });
      shown.current = chain;
      setTrip(chain);
      if (!r.failed) setBare(false);
      // Saved while this was on its way: the saved trip gets it too.
      if (saved.current)
        update(saved.current, (x) =>
          x.version === was.version ? { ...x, chain: chain.chain } : x,
        );
    }
    return saidOf(r, was.route.date < dayOf(Date.now()));
  });

  useEffect(() => {
    let gone = false;
    const short = hash.startsWith('/s/');
    const load = async () => {
      const id = crypto.randomUUID();
      if (!short) return decodeTrip(`#${hash}`, id);
      const x = await decodeTripLink(`#${hash}`, id, await stopNames());
      if (!x || !isPlanned(x)) return null;
      return { ...x, chain: { ...x.chain, warnings: await linkWarnings(x) } };
    };
    void load()
      .catch(() => null)
      .then((x) => {
        if (gone) return;
        const planned = x && isPlanned(x) ? x : null;
        shown.current = planned;
        setTrip(planned);
        // All it holds is the trains: the rest now, and said if it does not come.
        if (planned && short) {
          setBare(true);
          void reload();
        }
      });
    return () => {
      gone = true;
    };
  }, [hash, reload]);

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
  return (
    <main className="page trip-screen">
      <PullReload busy={busy} said={said} reload={reload} />
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
      </header>
      <header className="hero">
        <h1>{trip.name || autoName(trip.route, undefined, lineName) || t('newTour')}</h1>
        <p>{t('sharedTrip')}</p>
      </header>
      <p className="eyebrow">{longDate(trip.route.date, lang)}</p>
      <TripFacts chain={trip.chain} />
      {/* Said where it is seen, above the line; the line marks nothing missed while the stops
          between are not known yet. */}
      {bare && !busy && (
        <div className="notice">
          <p>{t('sharedBare')}</p>
          <button type="button" className="secondary" onClick={() => void reload()}>
            {t('retry')}
          </button>
        </div>
      )}
      <TripLine
        route={trip.route}
        rows={plannedRows(trip.route, trip.chain.connections, { partial: bare })}
        warnings={trip.chain.warnings}
        planning={false}
      />
      <div className="dock">
        <div className="dock-inner">
          {/* Any day, gone or not (0.52.0): a trip like any other. */}
          {
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
                saved.current = trip.id;
                location.replace(`#/trip/${trip.id}`);
              }}
            >
              {t('saveToTrips')}
            </button>
          }
        </div>
      </div>
    </main>
  );
}
