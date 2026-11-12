import type { CSSProperties, ReactNode } from 'react';
import { type LiveState } from '../core/live';
import type { PlannedTrip } from '../core/trip';
import { undo } from '../core/trip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { badge } from './format';
import { hhmm } from './format';
import type { useLive } from './useLive';

/** The next step in one sentence: what, when, where. */
function NextStep({
  state,
  now,
  source,
  change,
}: {
  state: LiveState;
  now: number;
  /** Opens the trip for another connection. */
  change: () => void;
  /** Where the times come from (live, or the timetable), said with them. */
  source: ReactNode;
}) {
  const t = useT();
  if (state.phase === 'done' || !state.next)
    return (
      <section className="next">
        <p className="next-label">{t('arrived')}</p>
        {source}
      </section>
    );
  const { next } = state;
  const ride = state.rides[next.ride]!;
  const inMin = Math.max(0, Math.round((next.at - now) / 60_000));
  // Held at a change missed, its train gone: said so, with the way to another (0.63.3).
  const missed = state.phase === 'waiting' && next.kind === 'board' && next.at < now - 60_000;
  const label = missed
    ? t('nowMissed')
    : next.kind === 'alight'
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
        {missed ? (
          <button type="button" className="text-button next-in" onClick={change}>
            {t('changeTrip')}
          </button>
        ) : (
          <span className="next-in">{inMin === 0 ? t('nowNow') : t('inMin', { n: inMin })}</span>
        )}
      </p>
      {/* Getting off: the label names the station already; only its platform is new. */}
      {(next.kind === 'board' || next.stop.platform) && (
        <p className="next-what">
          {next.kind === 'board' && <span className="badge">{badge(ride.s)}</span>}
          <span>
            {next.kind === 'board'
              ? [
                  t('toward', { to: ride.s.to.name }),
                  next.stop.platform && t('platform', { p: next.stop.platform }),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('platform', { p: next.stop.platform! })}
          </span>
        </p>
      )}
      {source}
    </section>
  );
}

/** Undo of the last change made under way, following or changing. */
export function UndoChange({ trip }: { trip: PlannedTrip }) {
  const t = useT();
  const update = useTrips((s) => s.update);
  if (!trip.previous) return null;
  return (
    <div className="live-actions">
      <button type="button" className="text-button" onClick={() => update(trip.id, undo)}>
        {t('undoChange')}
      </button>
    </div>
  );
}

/**
 * What is live about a trip followed (SPEC §3a): progress, the next step, connections at risk.
 * Changing it (0.63.2) shows none of this; the line keeps its live times and marker.
 */
export function TripLive({
  live,
  change,
}: {
  live: ReturnType<typeof useLive>;
  change: () => void;
}) {
  const t = useT();
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
          <NextStep
            state={state}
            now={live.now}
            change={change}
            source={
              <p className="muted live-source">
                {live.failed
                  ? live.fetchedAt
                    ? t('liveStale', { time: hhmm(live.fetchedAt) })
                    : t('liveOffline')
                  : live.fetchedAt
                    ? t('liveAt', { time: hhmm(live.fetchedAt) })
                    : t('liveTimetable')}
              </p>
            }
          />
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
    </>
  );
}
