import type { TicketType, Tour } from '../core/model';
import { usePrefs, useT } from '../store';
import { shortDate } from './format';

const TICKETS: [TicketType, 'ticketGA' | 'ticketDay' | 'ticketHalf' | 'ticketNone'][] = [
  ['GA', 'ticketGA'],
  ['Tageskarte', 'ticketDay'],
  ['Halbtax', 'ticketHalf'],
  ['none', 'ticketNone'],
];

/** When and with which ticket: date, depart at / back by + time, ticket. Kept on the route as
 * the values last used, so the next plan starts from them. */
export function PlanSettings({ tour, edit }: { tour: Tour; edit: (f: (x: Tour) => Tour) => void }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const departs = 'departAt' in tour.anchor;
  const time = 'departAt' in tour.anchor ? tour.anchor.departAt : tour.anchor.arriveBy;
  return (
    <div className="strip">
      <label className="pill picker-pill">
        <span aria-hidden="true">{shortDate(tour.date, lang)}</span>
        <input
          aria-label={t('date')}
          type="date"
          value={tour.date}
          onChange={(e) => e.target.value && edit((x) => ({ ...x, date: e.target.value }))}
        />
      </label>
      <span className="pill">
        <span className="seg" role="group" aria-label={t('anchor')}>
          <button
            type="button"
            aria-pressed={departs}
            onClick={() => edit((x) => ({ ...x, anchor: { departAt: time } }))}
          >
            {t('departAt')}
          </button>
          <button
            type="button"
            aria-pressed={!departs}
            onClick={() => edit((x) => ({ ...x, anchor: { arriveBy: time } }))}
          >
            {t('arriveBy')}
          </button>
        </span>
        <label className="picker-pill time-pill">
          <span aria-hidden="true" className="num">
            {time}
          </span>
          <input
            aria-label={t('time')}
            type="time"
            value={time}
            onChange={(e) =>
              e.target.value &&
              edit((x) => ({
                ...x,
                anchor: departs ? { departAt: e.target.value } : { arriveBy: e.target.value },
              }))
            }
          />
        </label>
      </span>
      <label className="pill">
        <span className="sr-only">{t('ticket')}</span>
        <select
          value={tour.ticket}
          onChange={(e) => edit((x) => ({ ...x, ticket: e.target.value as TicketType }))}
        >
          {TICKETS.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
