// Planning a trip's route, shared by the trip screen (usePlanner) and the background planner
// (autoplan): one request per route at a time, the result kept with its options
// (srr.plans.v1) and written into the trip unless its route changed meanwhile.
import { plan, type PlanResult } from '../core/planner/plan';
import { compactTrip, dayOf, type Trip } from '../core/trip';
import { GA, TEMPLATES } from '../data';
import { usePrefs } from '../store';
import { useTrips } from '../trips';
import { log } from './log';
import { cachedTrips } from './answers';
import { placeByName } from '../core/stops';
import { stopSearch } from './stops';
import { savePlan } from './tours';

export const routeJson = (t: Trip) => JSON.stringify(t.route);

/**
 * Today, a time already gone plans from now: connections that have left are none to take. Not
 * when you set that time after it had gone (`editedAt`, 0.49.0): a trip already under way is put
 * in from when it left.
 */
export function fromNow(route: Trip['route'], now: number, editedAt?: string): Trip['route'] {
  if (route.date !== dayOf(now) || !('departAt' in route.anchor)) return route;
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ms);
  const hm = fmt(now);
  if (route.anchor.departAt >= hm) return route;
  const edited = editedAt ? Date.parse(editedAt) : NaN;
  if (!Number.isNaN(edited) && dayOf(edited) === route.date && fmt(edited) > route.anchor.departAt)
    return route;
  return { ...route, anchor: { departAt: hm } };
}

/** A plan under way, shared by everyone who asked for it; stopped once all of them gave up. */
interface Running {
  p: Promise<PlanResult>;
  ctrl: AbortController;
  users: number;
}
const running = new Map<string, Running>();

/** `p` for one caller: rejects when that caller's own signal aborts, and lets go of the plan. */
function join(key: string, r: Running, signal?: AbortSignal): Promise<PlanResult> {
  r.users++;
  if (!signal) return r.p;
  const drop = () => {
    if (--r.users > 0 || running.get(key) !== r) return;
    // Nobody waits for it any more: stop its requests, and the next ask starts afresh.
    running.delete(key);
    r.ctrl.abort();
  };
  if (signal.aborted) {
    drop();
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const leave = () => {
      drop();
      reject(signal.reason);
    };
    signal.addEventListener('abort', leave, { once: true });
    r.p.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave));
  });
}

/**
 * Plans `trip`'s route (the same route asked twice shares one request). `keep: false` asks
 * without saving (more options from another time, the trip itself unchanged). `signal` stops
 * only this caller; the requests stop once every caller has.
 */
export function planRoute(trip: Trip, signal?: AbortSignal, keep = true): Promise<PlanResult> {
  const json = routeJson(trip);
  const reservations = usePrefs.getState().reservations;
  const key = `${trip.id}|${json}|${keep}|${reservations}`;
  const known = running.get(key);
  if (known) {
    log('plan.shared', { trip: trip.id, keep });
    return join(key, known, signal);
  }
  const ctrl = new AbortController();
  const t0 = performance.now();
  const route = trip.route;
  log('plan.start', {
    trip: trip.id,
    keep,
    date: route.date,
    anchor: route.anchor,
    reservations,
    stops: route.waypoints.map(
      (w) =>
        `${w.name}${w.kind === 'stop' ? ` (${w.dwellMin} min)` : w.kind === 'via' ? ' (via)' : ''}${w.ring ? ' ring' : ''}${w.templateId ? ` [${w.templateId}]` : ''}`,
    ),
  });
  const p = (async () => {
    const index = await stopSearch();
    const planned = await plan(
      fromNow(JSON.parse(json) as Trip['route'], Date.now(), trip.editedAt),
      {
        trace: (event, data) => log(event, { trip: trip.id, ...(data as object) }),
        fetchTrips: (q) => cachedTrips(q, ctrl.signal),
        templates: TEMPLATES,
        ga: GA,
        stop: (ref) => index.byRef(ref),
        place: placeByName(index),
        reservations,
      },
    );
    const r: PlanResult = { ...planned, reservations };
    log('plan.done', {
      trip: trip.id,
      keep,
      ms: Math.round(performance.now() - t0),
      options: r.options?.length ?? 0,
      failedLeg: r.failedLeg,
      relaxed: r.relaxed,
    });
    if (!keep) return r;
    // Kept for trips that still exist only, so the cache does not grow for good.
    await savePlan(
      trip.id,
      { tourJson: json, at: new Date().toISOString(), result: r },
      new Set(useTrips.getState().trips.map((t) => t.id)),
    );
    return r;
  })()
    .catch((e: unknown) => {
      log('plan.fail', {
        trip: trip.id,
        keep,
        ms: Math.round(performance.now() - t0),
        e,
        aborted: ctrl.signal.aborted,
      });
      throw e;
    })
    .finally(() => {
      if (running.get(key) === entry) running.delete(key);
    });
  const entry: Running = { p, ctrl, users: 0 };
  running.set(key, entry);
  return join(key, entry, signal);
}

/** The trip takes the recommended option, unless its route changed or it was planned since. */
export function keepPlan(id: string, json: string, r: PlanResult): boolean {
  // Planned before the setting changed: the trip waits for the plan under the new one.
  if ((r.reservations ?? 'avoid') !== usePrefs.getState().reservations) {
    log('plan.keep.outdated', { trip: id });
    return true;
  }
  const chain = r.recommended ?? r.options?.[0];
  if (!chain || !r.legs) {
    log('plan.keep.none', { trip: id });
    return false;
  }
  const legs = r.legs;
  useTrips.getState().update(id, (t) => {
    const fits = routeJson(t) === json && !t.chain;
    log('plan.keep', { trip: id, kept: fits, dep: chain.dep, arr: chain.arr });
    return fits ? compactTrip({ ...t, chain, legs, compact: undefined }) : t;
  });
  return true;
}
