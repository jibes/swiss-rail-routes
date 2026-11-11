import { decodeTour } from '../core/export/share';
import { parseRoute } from '../core/export/routeLink';
import { stopKey } from '../core/stops';
import { TEMPLATES } from '../data';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';
import { lineName } from './TemplatePicker';
import { useT } from '../store';
import { useTrips } from '../trips';
import { dayOf, newTrip } from '../core/trip';
import { staysOnDay } from '../core/stay';
import { markRings } from '../core/line';
import { autoName } from '../core/naming';
import { go } from './useHash';
import { Icon } from './icons';
import { routeRows } from '../core/rows';
import { TripLine } from './TripLine';

/**
 * A route someone shared: `#/r/<stops>?…` (or a route's address from another device), or the
 * older `#/t/<data>`. It becomes a new trip on this device, planned on its date (or today, when
 * the link names none or a day gone).
 */
export function SharedTour({
  stops,
  query = '',
  legacy,
}: {
  stops?: string;
  query?: string;
  legacy?: string;
}) {
  const t = useT();
  const add = useTrips((s) => s.add);
  const index = useStopIndex();
  const now = useNow();
  const tour =
    legacy !== undefined
      ? decodeTour(`#${legacy}`, 'shared')
      : (() => {
          const r = parseRoute(stops ?? '', new URLSearchParams(query), {
            templates: TEMPLATES,
            name: (ref) =>
              index?.byRef(stopKey(ref))?.name ??
              TEMPLATES.flatMap((x) => x.chain).find((c) => c.ref === ref)?.name,
            today: dayOf(now),
          });
          return r && { ...r, id: 'shared' };
        })();
  if (!tour)
    return (
      <main className="page">
        <p role="alert">{t('sharedBroken')}</p>
        <button type="button" className="secondary" onClick={() => go('/')}>
          {t('back')}
        </button>
      </main>
    );
  const { id: _id, ...rest } = tour;
  // A scenic line's stations as rings, as on the trip it becomes.
  const shown = { ...tour, waypoints: markRings(tour.waypoints) };
  return (
    <main className="page trip-screen">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
      </header>
      <header className="hero">
        <h1>
          {tour.name || autoName(shown, (r) => index?.byRef(stopKey(r)), lineName) || t('newTour')}
        </h1>
        <p>{t('sharedTour')}</p>
      </header>
      <TripLine route={shown} rows={routeRows(shown)} warnings={[]} planning={false} />
      <div className="dock">
        <div className="dock-inner">
          <button
            type="button"
            className="primary wide"
            // Replace: Back must not offer the same route to save again.
            onClick={() => {
              const id = crypto.randomUUID();
              const today = dayOf(Date.now()); // in the tap, not in render
              const date = rest.date >= today ? rest.date : today;
              add(
                newTrip(
                  id,
                  // A stay until a date and time moves with the day (review of 11 Nov 2026).
                  {
                    ...rest,
                    id,
                    date,
                    waypoints: staysOnDay(markRings(rest.waypoints), rest.date, date),
                  },
                  undefined,
                  undefined,
                  new Date(),
                ),
              );
              location.replace(`#/trip/${id}`);
            }}
          >
            {t('planSharedRoute')}
          </button>
        </div>
      </div>
    </main>
  );
}
