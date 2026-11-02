// Plans a trip while you edit it (0.4.0): whenever its route has no timetable, after a short
// quiet; the result goes into the trip (the recommended option, or the one picked), and the
// options are kept with the last plan (srr.plans.v1) for when the screen opens again.
import { useEffect, useState } from 'react';
import { plan, type PlanResult, type PlannedChain } from '../core/planner/plan';
import { compactTrip, type Trip } from '../core/trip';
import { GA, SEGMENTS, TEMPLATES } from '../data';
import { PlanningUnavailable, WorkerError, fetchTrips } from '../io/ojp';
import { stopSearch } from '../io/stops';
import { loadPlans, savePlans } from '../io/tours';
import { useTrips } from '../trips';
import { askNotifications } from '../io/notifications';

export type PlanStatus = 'idle' | 'planning' | 'done' | 'unavailable' | 'error';

/** Edits come in bursts (a chip, then another): plan once they settle. */
const QUIET_MS = 400;

const routeJson = (t: Trip) => JSON.stringify(t.route);

export function usePlanner(trip: Trip | undefined, enabled: boolean) {
  const update = useTrips((s) => s.update);
  const [status, setStatus] = useState<PlanStatus>('idle');
  // The result with the route it was planned for: options of an older route never show or pick.
  const [planned_, setPlanned] = useState<{ json: string; result: PlanResult } | null>(null);
  const setResult = (result: PlanResult, forJson: string) => setPlanned({ json: forJson, result });
  const [detail, setDetail] = useState('');
  const [attempt, setAttempt] = useState(0);
  const id = trip?.id;
  const json = trip ? routeJson(trip) : '';
  const needs = !!trip && enabled && trip.route.waypoints.length >= 2;
  const planned = !!trip?.chain;

  useEffect(() => {
    // Nothing to plan: the returned status says 'idle' (below).
    if (!id || !needs) return;
    const ctrl = new AbortController();
    const timer = setTimeout(
      async () => {
        const saved = (await loadPlans())[id];
        if (ctrl.signal.aborted) return;
        if (saved?.tourJson === json && saved.result.legs && saved.result.options) {
          setResult(saved.result, json);
          setStatus('done');
          if (!planned) keep(saved.result);
          return;
        }
        if (planned) {
          // A timetable from before plans were kept with the trip: keep it, nothing to ask.
          setStatus('done');
          return;
        }
        setStatus('planning');
        try {
          const index = await stopSearch();
          const tour = JSON.parse(json) as Trip['route'];
          const r = await plan(tour, {
            fetchTrips: (q) => fetchTrips(q, ctrl.signal),
            templates: TEMPLATES,
            segments: SEGMENTS,
            ga: GA,
            stop: (ref) => index.byRef(ref),
          });
          if (ctrl.signal.aborted) return;
          setResult(r, json);
          setStatus('done');
          keep(r);
          // Kept for trips that still exist only, so the cache does not grow for good.
          const plans = await loadPlans();
          const ids = new Set(useTrips.getState().trips.map((t) => t.id));
          await savePlans({
            ...Object.fromEntries(Object.entries(plans).filter(([k]) => ids.has(k))),
            [id]: { tourJson: json, at: new Date().toISOString(), result: r },
          });
        } catch (e) {
          if (ctrl.signal.aborted) return;
          setDetail(
            e instanceof WorkerError
              ? e.detail
              : e instanceof Error
                ? `${e.name}: ${e.message}`
                : '',
          );
          setStatus(e instanceof PlanningUnavailable ? 'unavailable' : 'error');
        }
      },
      planned ? 0 : QUIET_MS,
    );
    // The trip takes the recommended option, unless its route changed meanwhile.
    function keep(r: PlanResult) {
      const chain = r.recommended ?? r.options?.[0];
      if (!chain || !r.legs) return;
      // A trip with a timetable is what notifications are for: ask once (Android; no-op on the web).
      void askNotifications();
      update(id!, (t) =>
        routeJson(t) === json && !t.chain
          ? compactTrip({ ...t, chain, legs: r.legs!, compact: undefined })
          : t,
      );
    }
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [id, json, needs, planned, attempt, update]);

  const result = planned_?.json === json ? planned_.result : null;
  const pick = (c: PlannedChain) => {
    if (!id || !result?.legs) return;
    const legs = result.legs;
    update(id, (t) =>
      routeJson(t) === json ? compactTrip({ ...t, chain: c, legs, compact: undefined }) : t,
    );
  };

  return {
    status: needs ? status : 'idle',
    result: needs ? result : null,
    /** The last options shown, kept (dimmed) while the next ones are planned: the bar does not
     * empty and jump under the finger. */
    shown: needs ? (result ?? (status === 'planning' ? (planned_?.result ?? null) : null)) : null,
    detail,
    retry: () => setAttempt((a) => a + 1),
    pick,
  };
}
