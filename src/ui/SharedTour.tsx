import { decodeTour } from '../core/export/share';
import { parseRoute } from '../core/export/routeLink';
import { stopKey } from '../core/stops';
import { TEMPLATES } from '../data';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';
import { useT } from '../store';
import { useTrips } from '../trips';
import { dayOf, defaultDate, newTrip } from '../core/trip';
import { markRings } from '../core/line';
import { go } from './useHash';
import { Icon } from './icons';

/**
 * A route someone shared: `#/r/<stops>?…` (or a route's address from another device), or the
 * older `#/t/<data>`. It becomes a new trip on this device, planned on its date (or next Saturday).
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
            today: defaultDate(now),
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
  return (
    <main className="page">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
      </header>
      <header className="hero">
        <h1>{tour.name || t('untitled')}</h1>
        <p>{t('sharedTour')}</p>
      </header>
      <ol className="line">
        {tour.waypoints.map((w, i) => (
          <li
            key={i}
            className={`stop ${w.kind === 'via' ? 'via' : ''} ${i === tour.waypoints.length - 1 ? 'last' : ''}`}
          >
            <span className="dot" aria-hidden="true" />
            <div className="stop-head">
              <span className="stop-name">
                <span>{w.name}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="dock">
        <div className="dock-inner">
          <button
            type="button"
            className="primary wide"
            // Replace: Back must not offer the same route to save again.
            onClick={() => {
              const id = crypto.randomUUID();
              const today = dayOf(Date.now()); // in the tap, not in render
              const date = rest.date >= today ? rest.date : defaultDate();
              add(
                newTrip(
                  id,
                  { ...rest, id, date, waypoints: markRings(rest.waypoints) },
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
