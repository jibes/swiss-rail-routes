import { useState } from 'react';
import { encodeTrip } from '../core/export/tripShare';
import { tripStatus, undo } from '../core/trip';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { ChainView } from './ChainView';
import { ExportSheet } from './ExportSheet';
import { duration, hhmm, longDate, minutesBetween } from './format';
import { Icon } from './icons';
import { go } from './useHash';
import { useNow } from './useNow';

/** A saved trip: its timetable as planned (or replanned), tickets, exports. */
export function TripView({ id }: { id: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const remove = useTrips((s) => s.remove);
  const update = useTrips((s) => s.update);
  const [confirm, setConfirm] = useState(false);
  const now = useNow();

  if (!trip)
    return (
      <main className="page">
        <p>{t('notFound')}</p>
        <button type="button" className="secondary" onClick={() => go('/trips')}>
          {t('back')}
        </button>
      </main>
    );
  const status = tripStatus(trip, now);
  const changes = trip.chain.connections.reduce((n, c) => n + c.transfers, 0);

  return (
    <main className="page">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/trips')}>
          <Icon name="back" />
        </button>
        <h1>{trip.name || t('untitled')}</h1>
        <button
          type="button"
          className="icon"
          aria-label={t('map')}
          onClick={() => go(`/trip/${id}/map`)}
        >
          <Icon name="map" />
        </button>
      </header>

      <p className="muted">
        {longDate(trip.route.date, lang)}
        {trip.version > 1 && ` · ${t('replanned')}`}
      </p>

      {status === 'live' && (
        <a className="primary" href={`#/trip/${id}/now`}>
          {t('openLive')}
        </a>
      )}

      <div className="summary">
        <span className="big">
          {hhmm(trip.chain.dep)} – {hhmm(trip.chain.arr)}
        </span>
        <span className="muted">
          {duration(minutesBetween(trip.chain.dep, trip.chain.arr))} ·{' '}
          {changes === 1 ? t('transfer1') : t('transfers', { n: changes })}
        </span>
      </div>

      {trip.previous && (
        <button type="button" className="text-button" onClick={() => update(id, undo)}>
          {t('undoReplan')}
        </button>
      )}

      <ChainView chain={trip.chain} dwell={trip.legs.map((l) => l.to.dwellMin)} />

      <ExportSheet
        tour={trip.route}
        chain={trip.chain}
        legs={trip.legs}
        shareHash={() => encodeTrip(trip)}
      />

      <button
        type="button"
        className={`text-button ${confirm ? 'danger' : ''}`}
        onClick={() => {
          if (!confirm) return setConfirm(true);
          remove(id);
          go('/trips');
        }}
      >
        {confirm ? t('confirmDeleteTrip') : t('deleteTrip')}
      </button>
    </main>
  );
}
