import type { CSSProperties } from 'react';
import type { LiveState } from '../core/live';
import { useT } from '../store';
import { undo } from '../core/trip';
import { useTrips } from '../trips';
import { badge, ChainView } from './ChainView';
import { hhmm } from './format';
import { Icon } from './icons';
import { go } from './useHash';
import { useLive } from './useLive';

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

/** "Now": a trip under way, from the timetable plus live delays. */
export function NowView({ id }: { id: string }) {
  const t = useT();
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const update = useTrips((s) => s.update);
  const { state, now, fetchedAt, failed } = useLive(trip);
  if (!trip || !state)
    return (
      <main className="page">
        <p>{t('notFound')}</p>
      </main>
    );
  return (
    <main className="page now">
      <header className="bar">
        <button
          type="button"
          className="icon"
          aria-label={t('back')}
          onClick={() => go(`/trip/${id}`)}
        >
          <Icon name="back" />
        </button>
        <h1>{trip.name || t('untitled')}</h1>
      </header>

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

      <NextStep state={state} now={now} />

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

      {trip.previous && (
        <button type="button" className="text-button" onClick={() => update(id, undo)}>
          {t('undoReplan')}
        </button>
      )}

      <ChainView
        chain={trip.chain}
        dwell={trip.legs.map((l) => l.to.dwellMin)}
        live={{ state, now }}
      />

      {state.phase !== 'done' && (
        <div className="dock">
          <div className="dock-inner">
            <a
              className={`${state.risks.length ? 'primary' : 'secondary'} wide`}
              href={`#/trip/${id}/replan`}
            >
              <Icon name="route" />
              {t('replanHere')}
            </a>
          </div>
        </div>
      )}

      <p className="muted live-source">
        {fetchedAt
          ? t('liveAt', { time: hhmm(fetchedAt) })
          : failed
            ? t('liveOffline')
            : t('liveTimetable')}
      </p>
    </main>
  );
}
