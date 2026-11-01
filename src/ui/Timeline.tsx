import { useEffect, useState } from 'react';
import { plan, type PlanResult, type PlannedChain } from '../core/planner/plan';
import { expandLegs } from '../core/tour';
import { GA, SEGMENTS } from '../data';
import { PlanningUnavailable, WorkerError, fetchTrips } from '../io/ojp';
import { stopSearch } from '../io/stops';
import { loadPlans, savePlans } from '../io/tours';
import { useT } from '../store';
import { useTours } from '../tours';
import { askNotifications } from '../io/notifications';
import { useTrips } from '../trips';
import { newTrip } from '../core/trip';
import { NotFound, useAddress } from './Builder';
import { ChainView } from './ChainView';
import { OptionTabs } from './OptionTabs';
import { PlanSettings } from './PlanSettings';
import { duration, hhmm, minutesBetween } from './format';
import { TEMPLATES } from './TemplatePicker';
import { Icon } from './icons';
import { useStopIndex } from './useStopIndex';
import { autoName } from '../core/naming';
import { stopKey } from '../core/stops';
import { go } from './useHash';

type Status = 'planning' | 'done' | 'unavailable' | 'error';

/** Earlier/Later move the tour's anchor time by an hour, within the day. */
function shifted(time: string, min: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + min));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function Timeline({ id }: { id: string }) {
  const t = useT();
  const tour = useTours((s) => s.tours.find((x) => x.id === id));
  const [status, setStatus] = useState<Status>('planning');
  const [result, setResult] = useState<PlanResult | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const update = useTours((s) => s.update);
  const addTrip = useTrips((s) => s.add);
  const index = useStopIndex();
  const stop = (r: string) => index?.byRef(stopKey(r));
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState('');
  const json = tour ? JSON.stringify(tour) : '';

  useEffect(() => {
    if (!json) return;
    const current = JSON.parse(json) as NonNullable<typeof tour>;
    const ctrl = new AbortController();
    (async () => {
      const saved = (await loadPlans())[current.id];
      // Plans saved before they carried their legs are planned again.
      if (saved?.tourJson === json && saved.result.legs && saved.result.options) {
        setResult(saved.result);
        setStatus('done');
        return;
      }
      setStatus('planning');
      try {
        const index = await stopSearch();
        const r = await plan(current, {
          fetchTrips: (q) => fetchTrips(q, ctrl.signal),
          templates: TEMPLATES,
          segments: SEGMENTS,
          ga: GA,
          stop: (ref) => index.byRef(ref),
        });
        if (ctrl.signal.aborted) return;
        setResult(r);
        setStatus('done');
        const plans = await loadPlans();
        await savePlans({
          ...plans,
          [current.id]: { tourJson: json, at: new Date().toISOString(), result: r },
        });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setDetail(
          e instanceof WorkerError ? e.detail : e instanceof Error ? `${e.name}: ${e.message}` : '',
        );
        setStatus(e instanceof PlanningUnavailable ? 'unavailable' : 'error');
      }
    })();
    return () => ctrl.abort();
  }, [json, attempt]);

  useAddress(tour, '/plan');
  if (!tour) return <NotFound />;
  const legs = result?.legs ?? expandLegs(tour);
  const options = result?.options ?? [];
  // The option shown: the one picked (by departure), else the recommended one.
  const chain: PlannedChain | undefined =
    options.find((c) => c.dep === picked) ?? result?.recommended ?? options[0];
  const anchorTime = 'departAt' in tour.anchor ? tour.anchor.departAt : tour.anchor.arriveBy;
  const shift = (min: number) => {
    setPicked(null);
    update(id, (x) => ({
      ...x,
      anchor:
        'departAt' in x.anchor
          ? { departAt: shifted(anchorTime, min) }
          : { arriveBy: shifted(anchorTime, min) },
    }));
  };

  const total = chain ? minutesBetween(chain.dep, chain.arr) : 0;
  const changes = chain ? chain.connections.reduce((n, c) => n + c.transfers, 0) : 0;

  return (
    <main className="page timeline">
      <header className="bar">
        <button
          type="button"
          className="icon"
          aria-label={t('edit')}
          onClick={() => go(`/tour/${id}`)}
        >
          <Icon name="back" />
        </button>
        <h1>{tour.name || autoName(tour, stop) || t('untitled')}</h1>
        <button
          type="button"
          className="icon"
          aria-label={t('map')}
          onClick={() => go(`/tour/${id}/map`)}
        >
          <Icon name="map" />
        </button>
      </header>

      <PlanSettings tour={tour} edit={(f) => update(id, f)} />

      {status === 'planning' && (
        <p role="status" className="muted">
          {t('planning')}
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status" className="notice">
          {t('planUnavailable')}
        </p>
      )}
      {status === 'error' && (
        <div role="alert" className="notice red">
          <span>
            {t('planFailed')} {detail && <code className="muted">{detail}</code>}{' '}
            <button type="button" className="text-button" onClick={() => setAttempt((a) => a + 1)}>
              {t('retry')}
            </button>
          </span>
        </div>
      )}

      {status === 'done' && result && (
        <>
          {result.failedLeg !== undefined && (
            <p role="alert" className="notice red">
              {t('legFailed', {
                n: result.failedLeg + 1,
                from: legs[result.failedLeg]?.from.name ?? '',
                to: legs[result.failedLeg]?.to.name ?? '',
              })}
            </p>
          )}
          {result.relaxed.map((r, i) => (
            <p key={i} className="notice">
              {t(r.rule === 'mustPass' ? 'relaxedMustPass' : 'relaxedAvoid', { n: r.legIndex + 1 })}
            </p>
          ))}
          {chain && (
            <>
              <div className="options-bar">
                <button
                  type="button"
                  className="icon"
                  aria-label={t('earlier')}
                  onClick={() => shift(-60)}
                >
                  <Icon name="back" />
                </button>
                <OptionTabs
                  options={options}
                  recommended={result.recommended}
                  shown={chain}
                  onPick={setPicked}
                />
                <button
                  type="button"
                  className="icon"
                  aria-label={t('later')}
                  onClick={() => shift(60)}
                >
                  <Icon name="next" />
                </button>
              </div>

              <div className="summary">
                <span className="big">
                  {hhmm(chain.dep)} – {hhmm(chain.arr)}
                </span>
                <span className="muted">
                  {duration(total)} ·{' '}
                  {changes === 1 ? t('transfer1') : t('transfers', { n: changes })}
                </span>
              </div>

              <div role={options.length > 1 ? 'tabpanel' : undefined}>
                <ChainView chain={chain} dwell={legs.map((l) => l.to.dwellMin)} />
              </div>
              <div className="dock">
                <div className="dock-inner">
                  <button
                    type="button"
                    className="primary wide"
                    onClick={() => {
                      void askNotifications();
                      const tripId = crypto.randomUUID();
                      addTrip(
                        newTrip(
                          tripId,
                          { ...tour, name: tour.name || autoName(tour, stop) },
                          legs,
                          chain,
                          new Date(),
                        ),
                      );
                      go(`/trip/${tripId}`);
                    }}
                  >
                    {t('saveTrip')}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
