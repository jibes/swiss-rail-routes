import { useState } from 'react';
import { addWaypoint, moveWaypoint, removeWaypoint, replaceWaypoint, setStay } from '../core/edit';
import type { Tour } from '../core/model';
import { plan, type PlanResult } from '../core/planner/plan';
import { mergeReplan, remainingRoute, replanPoint, type ReplanPoint } from '../core/replan';
import { revise } from '../core/trip';
import { GA, SEGMENTS } from '../data';
import { fetchTrips, WorkerError } from '../io/ojp';
import { stopSearch } from '../io/stops';
import { useT } from '../store';
import { useTrips } from '../trips';
import { ChainView } from './ChainView';
import { hhmm } from './format';
import { Icon } from './icons';
import { OptionTabs } from './OptionTabs';
import { StopPicker } from './StopPicker';
import { StopRow } from './StopRow';
import { TEMPLATES } from './TemplatePicker';
import { useDragList } from './useDragList';
import { go } from './useHash';
import { useLive } from './useLive';

/** "Replan from here": the rest of the trip, editable, planned anew from the next point. */
export function ReplanView({ id }: { id: string }) {
  const t = useT();
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const update = useTrips((s) => s.update);
  const { state, now } = useLive(trip);
  // The point is fixed when the screen opens, so the plan matches what was shown.
  const [point] = useState<ReplanPoint | null>(() =>
    trip && state ? replanPoint(trip, state, now) : null,
  );
  const [draft, setDraft] = useState<Tour | null>(() =>
    trip && point ? remainingRoute(trip, point) : null,
  );
  const [result, setResult] = useState<PlanResult | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'planning' | 'error'>('idle');
  const [detail, setDetail] = useState('');
  const edit = (f: (x: Tour) => Tour) => {
    setDraft((d) => (d ? f(d) : d));
    setResult(null);
  };
  const { listRef, grip, rowStyle, dragging } = useDragList((from, to) => {
    // The start is where you are: it stays first.
    if (from === 0 || to === 0) return;
    edit((x) => moveWaypoint(x, from, to));
  });

  if (!trip || !point || !draft)
    return (
      <main className="page">
        <p>{t('notFound')}</p>
        <button type="button" className="secondary" onClick={() => go(`/trip/${id}`)}>
          {t('back')}
        </button>
      </main>
    );

  // Where the trip has been: the stations of the kept part, in order, with their times.
  const travelled = point.keep
    .flatMap((c) =>
      c.sections
        .filter((x) => x.mode !== 'walk')
        .flatMap((x) => [
          { name: x.from.name, at: Date.parse(x.from.dep ?? x.from.arr ?? '') },
          { name: x.to.name, at: Date.parse(x.to.arr ?? x.to.dep ?? '') },
        ]),
    )
    .filter((x, i, all) => x.name !== point.stop.name && (i === 0 || all[i - 1]!.name !== x.name));
  const options = result?.options ?? [];
  const chain = options.find((c) => c.dep === picked) ?? result?.recommended;
  const wps = draft.waypoints;

  const run = async () => {
    setStatus('planning');
    try {
      const index = await stopSearch();
      setResult(
        await plan(draft, {
          fetchTrips: (q) => fetchTrips(q),
          templates: TEMPLATES,
          segments: SEGMENTS,
          ga: GA,
          stop: (r) => index.byRef(r),
        }),
      );
      setPicked(null);
      setStatus('idle');
    } catch (e) {
      setDetail(e instanceof WorkerError ? e.detail : e instanceof Error ? e.message : '');
      setStatus('error');
    }
  };

  return (
    <main className="page replan">
      <header className="bar">
        <button
          type="button"
          className="icon"
          aria-label={t('back')}
          onClick={() => go(`/trip/${id}/now`)}
        >
          <Icon name="back" />
        </button>
        <h1>{t('replanFrom', { stop: point.stop.name })}</h1>
      </header>

      <p className="muted">{t('replanHint')}</p>

      <div>
        {travelled.length > 0 && (
          <ol className="line past" aria-label={t('travelled')}>
            {travelled.map((x, i) => (
              <li key={i} className="stop via">
                <span className="dot" aria-hidden="true" />
                <div className="stop-top">
                  <span className="stop-head">
                    <span className="stop-name">
                      <span>{x.name}</span>
                      <small className="num">{hhmm(x.at)}</small>
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
        <ol className="line" aria-label={t('stops')} ref={listRef}>
          {wps.map((w, i) => (
            <StopRow
              key={`${i}-${w.stopRef}`}
              w={w}
              index={i}
              last={i === wps.length - 1}
              fixed={i === 0}
              caption={i === 0 ? t('fromHere', { time: hhmm(point.at) }) : undefined}
              onStay={(m) => edit((x) => setStay(x, i, m))}
              onRemove={() => {
                if (i === 0) return;
                edit((x) => removeWaypoint(x, i));
              }}
              onReplace={(stop) => i > 0 && edit((x) => replaceWaypoint(x, i, stop))}
              grip={grip(i)}
              style={rowStyle(i)}
              dragging={dragging === i}
            />
          ))}
        </ol>
        <div className="stop add">
          <span className="dot" aria-hidden="true" />
          <StopPicker
            label={t('addStop')}
            onPick={(s) =>
              edit((x) => addWaypoint(x, { stopRef: s.ref, name: s.name }, x.waypoints.length - 1))
            }
          />
        </div>
      </div>

      {status === 'error' && (
        <p role="alert" className="notice red">
          {t('planFailed')} {detail && <code className="muted">{detail}</code>}
        </p>
      )}
      {result?.failedLeg !== undefined && (
        <p role="alert" className="notice red">
          {t('legFailed', {
            n: result.failedLeg + 1,
            from: result.legs?.[result.failedLeg]?.from.name ?? '',
            to: result.legs?.[result.failedLeg]?.to.name ?? '',
          })}
        </p>
      )}

      {!result && (
        <div className="dock">
          <div className="dock-inner">
            <button
              type="button"
              className="primary wide"
              disabled={status === 'planning' || wps.length < 2}
              onClick={() => void run()}
            >
              {status === 'planning' ? t('planning') : t('findConnections')}
            </button>
          </div>
        </div>
      )}

      {result && chain && (
        <>
          <OptionTabs
            options={options}
            recommended={result.recommended}
            shown={chain}
            onPick={setPicked}
          />
          <ChainView chain={chain} dwell={(result.legs ?? []).map((l) => l.to.dwellMin)} />
          <div className="dock">
            <div className="dock-inner">
              <button
                type="button"
                className="primary wide"
                onClick={() => {
                  update(id, (x) =>
                    revise(x, mergeReplan(x, point, result.legs ?? [], chain), new Date()),
                  );
                  go(`/trip/${id}/now`);
                }}
              >
                {t('updateTrip')}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
