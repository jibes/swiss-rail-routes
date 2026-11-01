import { useEffect, useState } from 'react';
import { plan, type PlanResult, type PlannedChain } from '../core/planner/plan';
import { expandLegs } from '../core/tour';
import { GA, SEGMENTS } from '../data';
import { PlanningUnavailable, WorkerError, fetchTrips } from '../io/ojp';
import { stopSearch } from '../io/stops';
import { loadPlans, savePlans } from '../io/tours';
import { useT } from '../store';
import { useTours } from '../tours';
import { NotFound } from './Builder';
import { ChainView } from './ChainView';
import { ExportSheet } from './ExportSheet';
import { duration, hhmm, minutesBetween } from './format';
import { TEMPLATES } from './TemplatePicker';
import { go } from './useHash';

type Status = 'planning' | 'done' | 'unavailable' | 'error';
const VIEWS = ['earliest', 'recommended', 'latest'] as const;

export function Timeline({ id }: { id: string }) {
  const t = useT();
  const tour = useTours((s) => s.tours.find((x) => x.id === id));
  const [status, setStatus] = useState<Status>('planning');
  const [result, setResult] = useState<PlanResult | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]>('recommended');
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState('');
  const json = tour ? JSON.stringify(tour) : '';

  useEffect(() => {
    if (!json) return;
    const current = JSON.parse(json) as NonNullable<typeof tour>;
    const ctrl = new AbortController();
    (async () => {
      const saved = (await loadPlans())[current.id];
      if (saved?.tourJson === json) {
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

  if (!tour) return <NotFound />;
  const legs = expandLegs(tour);
  const chain: PlannedChain | undefined = result?.[view];

  return (
    <main className="page timeline">
      <header className="bar">
        <button type="button" onClick={() => go(`/tour/${id}`)}>
          ← {t('edit')}
        </button>
        <h1>{tour.name || t('untitled')}</h1>
        <button type="button" onClick={() => go(`/tour/${id}/map`)}>
          {t('map')}
        </button>
      </header>

      {status === 'planning' && <p role="status">{t('planning')}</p>}
      {status === 'unavailable' && <p role="status">{t('planUnavailable')}</p>}
      {status === 'error' && (
        <p role="alert">
          {t('planFailed')} {detail && <code className="muted">{detail}</code>}{' '}
          <button type="button" onClick={() => setAttempt((a) => a + 1)}>
            {t('retry')}
          </button>
        </p>
      )}

      {status === 'done' && result && (
        <>
          {result.failedLeg !== undefined && (
            <p role="alert" className="chip red">
              {t('legFailed', {
                n: result.failedLeg + 1,
                from: legs[result.failedLeg]!.from.name,
                to: legs[result.failedLeg]!.to.name,
              })}
            </p>
          )}
          {result.relaxed.map((r, i) => (
            <p key={i} className="chip amber">
              {t(r.rule === 'mustPass' ? 'relaxedMustPass' : 'relaxedAvoid', { n: r.legIndex + 1 })}
            </p>
          ))}
          {chain && (
            <>
              <div role="tablist" className="tabs" aria-label={t('alternatives')}>
                {VIEWS.map((v) => {
                  const c = result[v];
                  return (
                    <button
                      key={v}
                      role="tab"
                      type="button"
                      aria-selected={view === v}
                      disabled={!c}
                      onClick={() => setView(v)}
                    >
                      <span>{t(v)}</span>
                      {c && (
                        <span className="muted">
                          {hhmm(c.dep)}–{hhmm(c.arr)} · {duration(minutesBetween(c.dep, c.arr))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div role="tabpanel">
                <ChainView chain={chain} dwell={legs.map((l) => l.to.dwellMin)} />
              </div>
              <ExportSheet tour={tour} chain={chain} />
            </>
          )}
        </>
      )}
    </main>
  );
}
