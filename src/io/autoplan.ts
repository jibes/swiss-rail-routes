// Trips without a timetable get one in the background (0.5.6): a route changed on another
// device, a trip left before its plan came, one made offline. One at a time, a few seconds
// apart; a failure is tried again after ten minutes, then twenty, forty… up to four hours (a
// line closed all day would otherwise be asked about all day), and at once when the device is
// back online or the route changes.
import { dayOf, isPlanned, type Trip } from '../core/trip';
import { usePrefs } from '../store';
import { useTrips } from '../trips';
import { log } from './log';
import { keepPlan, planRoute, routeJson } from './planTrip';

export const RETRY_MS = 10 * 60_000;
export const RETRY_MAX_MS = 4 * 60 * 60_000;
const GAP_MS = 3000;

/** How long after the n-th failure in a row the next try waits. */
export const retryAfterMs = (n: number) =>
  Math.min(RETRY_MS * 2 ** Math.max(0, n - 1), RETRY_MAX_MS);

export function watchAutoPlan() {
  /** Per trip and route: when it last failed, and how many times in a row. */
  const failed = new Map<string, { at: number; n: number }>();
  const nextTry = (f: { at: number; n: number }) => f.at + retryAfterMs(f.n);
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const due = (t: Trip, now: number) => {
    const f = failed.get(`${t.id}|${routeJson(t)}`);
    return (
      !isPlanned(t) &&
      t.route.waypoints.length >= 2 &&
      // Today and later: a day gone is planned only when opened (0.52.0).
      t.route.date >= dayOf(now) &&
      (!f || nextTry(f) <= now)
    );
  };
  const next = (ms = GAP_MS) => {
    clearTimeout(timer);
    timer = setTimeout(() => void step(), ms);
  };
  async function step() {
    if (busy || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const now = Date.now();
    const trips = useTrips.getState().trips;
    // Failures of routes no longer waiting (edited, planned, deleted, retired) are forgotten:
    // else their retry time, long past, would wake this every few seconds.
    const waiting = new Set(
      trips.filter((x) => !isPlanned(x)).map((x) => `${x.id}|${routeJson(x)}`),
    );
    for (const k of failed.keys()) if (!waiting.has(k)) failed.delete(k);
    const t = trips.find((x) => due(x, now));
    if (!t) {
      // Nothing due now: wake for the first failed trip whose wait is up.
      const first = Math.min(...[...failed.values()].map(nextTry));
      if (Number.isFinite(first)) next(Math.max(GAP_MS, first - now));
      return;
    }
    busy = true;
    const json = routeJson(t);
    const key = `${t.id}|${json}`;
    const fail = (e?: unknown) => {
      const n = (failed.get(key)?.n ?? 0) + 1;
      failed.set(key, { at: Date.now(), n });
      log('autoplan.fail', { trip: t.id, e, tries: n, retryMin: retryAfterMs(n) / 60_000 });
    };
    log('autoplan', { trip: t.id, date: t.route.date });
    try {
      // No connection found is a failure too, tried again later; not at once, in a loop.
      // Kept quietly: the permission is asked on the trip screen, never in the background.
      if (!keepPlan(t.id, json, await planRoute(t))) fail();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      next();
    }
  }
  const off = useTrips.subscribe((s, p) => s.trips !== p.trips && next());
  // A trip with no connection may have one under another choice of reservation trains.
  const offPrefs = usePrefs.subscribe((s, p) => {
    if (s.reservations === p.reservations) return;
    failed.clear();
    next();
  });
  const online = () => {
    failed.clear();
    next();
  };
  const win = typeof window === 'undefined' ? undefined : window;
  win?.addEventListener('online', online);
  next();
  return () => {
    off();
    offPrefs();
    clearTimeout(timer);
    win?.removeEventListener('online', online);
  };
}
