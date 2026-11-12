// A change ahead under way (0.62.0): the trip's own line is edited as at any time; what lies
// ahead is then planned from where you are (`restDraft`), and becomes the trip's once planned
// (`mergeReplan`, `revise`: Undo last change takes it back). The way behind you is kept as
// ridden. While it plans the line says so; where no plan comes, the change can be dropped.
import { useEffect, useState } from 'react';
import type { PlanResult } from '../core/planner/plan';
import { mergeReplan, replanPoint } from '../core/replan';
import { isPlanned, revise, type PlannedTrip } from '../core/trip';
import { log } from '../io/log';
import { PlanningUnavailable, WorkerError } from '../io/ojp';
import { planRoute } from '../io/planTrip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { PlanNotices, type PlanState } from './PlanNotices';
import { useRestDrafts } from './restDraft';
import { useStopIndex } from './useStopIndex';

/** Edits come in bursts (a stay, then another): plan once they settle, as before it leaves. */
const QUIET_MS = 400;

interface Planned {
  json: string;
  state: PlanState;
  result: PlanResult | null;
  detail: string;
}

export function RestApply({ trip }: { trip: PlannedTrip }) {
  const t = useT();
  const id = trip.id;
  const d = useRestDrafts((s) => s.drafts[id]);
  const drafts = useRestDrafts.getState;
  const update = useTrips((s) => s.update);
  const index = useStopIndex();
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [attempt, setAttempt] = useState(0);
  const draft = d?.route;
  const json = draft ? JSON.stringify(draft) : '';

  // Plans the rest whenever it changes (the same shared request as before it leaves).
  useEffect(() => {
    if (!draft) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setPlanned({ json, state: 'planning', result: null, detail: '' });
      log('replan.start', { trip: id, stops: draft.waypoints.map((w) => w.name) });
      try {
        const r = await planRoute(
          { ...trip, id: `${trip.id}-replan`, route: draft },
          ctrl.signal,
          false,
        );
        if (ctrl.signal.aborted) return;
        log('replan.done', { trip: id, options: r.options?.length ?? 0, failedLeg: r.failedLeg });
        setPlanned({ json, state: 'done', result: r, detail: '' });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        log('replan.fail', { trip: id, e });
        setPlanned({
          json,
          state: e instanceof PlanningUnavailable ? 'unavailable' : 'error',
          result: null,
          detail: e instanceof WorkerError ? e.detail : e instanceof Error ? e.name : '',
        });
      }
    }, QUIET_MS);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // The trip object changes with every live poll; planning follows the draft and Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, attempt]);

  // Changed meanwhile (another device, another tab, undo): the change was cut from another
  // version of the trip, so it is dropped rather than merged into this one.
  const changed = !!d && trip.version !== d.opened.version;
  // Planned: the trip's at once.
  useEffect(() => {
    if (!d) return;
    if (changed) {
      log('replan.outdated', { trip: id });
      drafts().discard(id);
      return;
    }
    const r = planned?.json === json && planned.state === 'done' ? planned.result : null;
    const c = r ? (r.recommended ?? null) : null;
    if (!r || !c) return;
    log('replan.save', { trip: id, dep: c.dep, arr: c.arr });
    update(id, (x) =>
      !isPlanned(x)
        ? x
        : revise(
            x,
            mergeReplan(
              x,
              replanPoint(x, d.opened.state, d.opened.now, (key) => {
                const st = index?.byRef(key);
                return st ? [st.lon, st.lat] : undefined;
              }) || d.point,
              r.legs ?? [],
              c,
            ),
            new Date(),
          ),
    );
    drafts().discard(id);
  }, [d, planned, json, changed, id, index, update, drafts]);

  if (!d) return null;
  const mine = planned?.json === json ? planned : null;
  const state: PlanState = mine ? mine.state : 'planning';
  const failed = state === 'error' || state === 'unavailable';
  return (
    <>
      <PlanNotices
        state={state}
        detail={mine?.detail ?? ''}
        result={mine?.result ?? null}
        retry={() => setAttempt((a) => a + 1)}
      />
      {/* No plan for the change: it is taken back here (else it waits for one). */}
      {(failed || (state === 'done' && !mine?.result?.recommended)) && (
        <p className="muted">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              log('replan.discard', { trip: id });
              drafts().discard(id);
            }}
          >
            {t('discardChanges')}
          </button>
        </p>
      )}
    </>
  );
}
