import { useState, type CSSProperties } from 'react';
import { encodeTrip } from '../core/export/tripShare';
import type { LiveState } from '../core/live';
import { tripStatus, undo } from '../core/trip';
import { usePrefs, useT } from '../store';
import { useTours } from '../tours';
import { useTrips } from '../trips';
import { badge, ChainView } from './ChainView';
import { ExportSheet } from './ExportSheet';
import { duration, hhmm, longDate, minutesBetween } from './format';
import { Icon } from './icons';
import { go } from './useHash';
import { useLive } from './useLive';
import { useNow } from './useNow';

/** The next step in one sentence: what, when, where. */
function NextStep({ state, now }: { state: LiveState; now: number }) {
  const t = useT();
  if (state.phase === 'done' || !state.next)
    return (
      <section className="next">
        <p className="next-label">{t('arrived')}</p>
      </section>
    );
  const { next } = state;
  const ride = state.rides[next.ride]!;
  const inMin = Math.max(0, Math.round((next.at - now) / 60_000));
  const label =
    next.kind === 'alight'
      ? t('nowAlight', { stop: next.stop.name })
      : state.phase === 'before'
        ? t('nowDepart')
        : t('nowChange');
  return (
    <section className="next" aria-live="polite">
      <p className="next-label">{label}</p>
      <p className="next-time">
        <span className="num">{hhmm(next.at)}</span>
        {next.delayMin > 0 && <span className="late"> +{next.delayMin}</span>}
        <span className="next-in">{inMin === 0 ? t('nowNow') : t('inMin', { n: inMin })}</span>
      </p>
      <p className="next-what">
        {next.kind === 'board' && <span className="badge">{badge(ride.s)}</span>}
        <span>
          {next.kind === 'board' ? t('toward', { to: ride.s.to.name }) : next.stop.name}
          {next.stop.platform && ` · ${t('platform', { p: next.stop.platform })}`}
        </span>
      </p>
    </section>
  );
}

/**
 * A saved trip, one screen for its whole life: before departure its timetable (edit all of
 * it), under way the same timetable live (next step, risks, where you are; change from here),
 * afterwards the record (plan the route again).
 */
export function TripView({ id }: { id: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const remove = useTrips((s) => s.remove);
  const update = useTrips((s) => s.update);
  const createRoute = useTours((s) => s.create);
  const [confirm, setConfirm] = useState(false);
  const now = useNow();
  const status = trip ? tripStatus(trip, now) : 'past';
  // Live calls only while the trip is under way.
  const live = useLive(status === 'live' ? trip : undefined);

  if (!trip)
    return (
      <main className="page">
        <p>{t('notFound')}</p>
        <button type="button" className="secondary" onClick={() => go('/trips')}>
          {t('back')}
        </button>
      </main>
    );
  const state = live.state;
  const changes = trip.chain.connections.reduce((n, c) => n + c.transfers, 0);

  return (
    <main className={`page ${state ? 'now' : ''}`}>
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

      {state ? (
        <>
          <div
            className="trip-progress"
            role="progressbar"
            aria-label={t('progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
            style={{ '--p': `${(state.progress * 100).toFixed(1)}%` } as CSSProperties}
          >
            <span />
          </div>
          <NextStep state={state} now={live.now} />
          {state.risks.map((r, i) => {
            const ride = state.rides[r.ride]!;
            const at = ride.stops[0]!.name;
            return (
              <div key={i} role="alert" className="notice red">
                <span>
                  {r.reason === 'cancelled'
                    ? t('riskCancelled', { line: badge(ride.s) })
                    : r.reason === 'missed'
                      ? t('riskMissed', { at })
                      : t('riskTight', { at, n: r.marginMin })}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <p className="muted">
            {longDate(trip.route.date, lang)}
            {trip.version > 1 && ` · ${t('replanned')}`}
          </p>
          <div className="summary">
            <span className="big">
              {hhmm(trip.chain.dep)} – {hhmm(trip.chain.arr)}
            </span>
            <span className="muted">
              {duration(minutesBetween(trip.chain.dep, trip.chain.arr))} ·{' '}
              {changes === 1 ? t('transfer1') : t('transfers', { n: changes })}
            </span>
          </div>
        </>
      )}

      {trip.previous && status !== 'past' && (
        <button type="button" className="text-button" onClick={() => update(id, undo)}>
          {t('undoReplan')}
        </button>
      )}

      <ChainView
        chain={trip.chain}
        dwell={trip.legs.map((l) => l.to.dwellMin)}
        live={state ? { state, now: live.now } : undefined}
      />

      {state && (
        <p className="muted live-source">
          {live.fetchedAt
            ? t('liveAt', { time: hhmm(live.fetchedAt) })
            : live.failed
              ? t('liveOffline')
              : t('liveTimetable')}
        </p>
      )}

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

      <div className="dock">
        <div className="dock-inner">
          {status === 'past' ? (
            <button
              type="button"
              className="secondary wide"
              onClick={() => {
                const { id: _id, ...route } = trip.route;
                go(`/tour/${createRoute({ ...route, name: trip.name })}`);
              }}
            >
              <Icon name="loop" />
              {t('planAgain')}
            </button>
          ) : (
            <a
              className={`${state?.risks.length ? 'primary' : 'secondary'} wide`}
              href={`#/trip/${id}/edit`}
            >
              <Icon name="route" />
              {status === 'live' ? t('replanHere') : t('editTrip')}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
