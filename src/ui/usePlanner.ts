// Plans a trip while you edit it (0.4.0): whenever its route has no timetable, after a short
// quiet; the result goes into the trip (the recommended option, or the one picked), and the
// options are kept with the last plan (srr.plans.v1) for when the screen opens again.
import { useEffect, useState } from 'react';
import { optionsKey } from '../core/answers';
import type { Tour } from '../core/model';
import type { PlanResult, PlannedChain } from '../core/planner/plan';
import { compactTrip, type Trip } from '../core/trip';
import { PlanningUnavailable, WorkerError } from '../io/ojp';
import { keepPlan, planRoute, routeJson } from '../io/planTrip';
import { loadPlans } from '../io/tours';
import { usePrefs } from '../store';
import { useTrips } from '../trips';
import { askNotifications } from '../io/notifications';
import { log } from '../io/log';

export type PlanStatus = 'idle' | 'planning' | 'done' | 'unavailable' | 'error';

/** Two routes (JSON) with the same options: the same stations, day and ticket. */
function sameOptions(a: string, b: string): boolean {
  try {
    return optionsKey(JSON.parse(a) as Tour) === optionsKey(JSON.parse(b) as Tour);
  } catch {
    return false;
  }
}

/** Edits come in bursts (a chip, then another): plan once they settle. */
const QUIET_MS = 400;

export function usePlanner(trip: Trip | undefined, enabled: boolean) {
  const update = useTrips((s) => s.update);
  const reservations = usePrefs((s) => s.reservations);
  // The status with the route it is about: after an edit an old error or "done" never shows
  // for the new route (it is planning until said otherwise).
  const [st, setSt] = useState<{ json: string; status: PlanStatus; detail: string }>({
    json: '',
    status: 'idle',
    detail: '',
  });
  // The result with the route it was planned for: options of an older route never show or pick.
  const [planned_, setPlanned] = useState<{ json: string; result: PlanResult } | null>(null);
  const setResult = (result: PlanResult, forJson: string) => setPlanned({ json: forJson, result });
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
        // The plan of this very route, or, once a connection is chosen, of the same stations
        // asked from another time or under another name: its options are still the options.
        if (
          saved?.result.legs &&
          saved.result.options &&
          (saved.result.reservations ?? 'avoid') === reservations &&
          (saved.tourJson === json || (planned && sameOptions(saved.tourJson, json)))
        ) {
          log('planner.cached', { trip: id, at: saved.at });
          setResult(saved.result, json);
          setSt({ json, status: 'done', detail: '' });
          if (!planned) keep(saved.result);
          return;
        }
        if (planned) {
          // A timetable from before plans were kept with the trip: keep it, nothing to ask.
          setSt({ json, status: 'done', detail: '' });
          return;
        }
        setSt({ json, status: 'planning', detail: '' });
        log('planner.plan', { trip: id });
        try {
          const current = useTrips.getState().trips.find((t) => t.id === id);
          if (!current) return;
          // Shared with the background planner: the same route is asked once.
          const r = await planRoute(current, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setResult(r, json);
          setSt({ json, status: 'done', detail: '' });
          keep(r);
        } catch (e) {
          if (ctrl.signal.aborted) return;
          log('planner.error', { trip: id, e });
          setSt({
            json,
            status: e instanceof PlanningUnavailable ? 'unavailable' : 'error',
            detail:
              e instanceof WorkerError
                ? e.detail
                : e instanceof Error
                  ? `${e.name}: ${e.message}`
                  : '',
          });
        }
      },
      planned ? 0 : QUIET_MS,
    );
    // The trip takes the recommended option, unless its route changed meanwhile.
    function keep(r: PlanResult) {
      // A trip with a timetable is what notifications are for: ask once (Android; no-op on the web).
      if (keepPlan(id!, json, r)) void askNotifications();
    }
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [id, json, needs, planned, attempt, update, reservations]);

  const result = planned_?.json === json ? planned_.result : null;
  const pick = (c: PlannedChain) => {
    if (!id || !result?.legs) return;
    log('planner.pick', { trip: id, dep: c.dep, arr: c.arr });
    const legs = result.legs;
    update(id, (t) =>
      routeJson(t) === json ? compactTrip({ ...t, chain: c, legs, compact: undefined }) : t,
    );
  };

  const status: PlanStatus = !needs ? 'idle' : st.json === json ? st.status : 'planning';
  return {
    status,
    result: needs ? result : null,
    /** The last plan of this screen, for whatever route: shown dimmed while the next comes. */
    previous: needs ? (planned_?.result ?? null) : null,
    detail: st.json === json ? st.detail : '',
    retry: () => setAttempt((a) => a + 1),
    pick,
  };
}
