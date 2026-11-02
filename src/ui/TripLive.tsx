import type { CSSProperties } from 'react';
import { type LiveState } from '../core/live';
import type { PlannedTrip } from '../core/trip';
import { undo } from '../core/trip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { badge, ChainView } from './ChainView';
import { hhmm } from './format';
import { Icon } from './icons';
import type { useLive } from './useLive';

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
    <section className="next">
      <p className="next-label" aria-live="polite">
        {label}
      </p>
      <p className="next-time">
        <span className="num">{hhmm(next.at)}</span>
        {next.delayMin > 0 && (
          <span className="late">
            {' '}
            <span aria-hidden="true">+{next.delayMin}</span>
            <span className="sr-only">{t('lateBy', { n: next.delayMin })}</span>
          </span>
        )}
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

/** The trip under way (SPEC §3a): progress, the next step, connections at risk, the timetable
 * live with where you are; Change the rest replans from here (the travelled part fixed). */
export function TripLive({ trip, live }: { trip: PlannedTrip; live: ReturnType<typeof useLive> }) {
  const t = useT();
  const update = useTrips((s) => s.update);
  const state = live.state;
  return (
    <>
      {state && (
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
                    : r.reason === 'notServed'
                      ? t('riskNotServed', { line: badge(ride.s), stop: r.stop ?? '' })
                      : r.reason === 'missed'
                        ? t('riskMissed', { at })
                        : t('riskTight', { at, n: r.marginMin })}
                </span>
              </div>
            );
          })}
        </>
      )}
      <div className="live-actions">
        <a
          className={`${state?.risks.length ? 'primary' : 'secondary'} wide`}
          href={`#/trip/${trip.id}/edit`}
        >
          <Icon name="route" />
          {t('replanHere')}
        </a>
        {trip.previous && (
          <button type="button" className="text-button" onClick={() => update(trip.id, undo)}>
            {t('undoChange')}
          </button>
        )}
      </div>
      <ChainView
        chain={trip.chain}
        dwell={trip.legs.map((l) => l.to.dwellMin)}
        live={state ? { state, now: live.now } : undefined}
      />
      {state && (
        <p className="muted live-source">
          {live.failed
            ? live.fetchedAt
              ? t('liveStale', { time: hhmm(live.fetchedAt) })
              : t('liveOffline')
            : live.fetchedAt
              ? t('liveAt', { time: hhmm(live.fetchedAt) })
              : t('liveTimetable')}
        </p>
      )}
    </>
  );
}
