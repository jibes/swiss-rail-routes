// Trips without a timetable get one in the background (0.5.6): a route changed on another
// device, a trip left before its plan came, one made offline. One at a time, a few seconds
// apart; a failure is tried again after ten minutes or when the device is back online.
import { isPlanned, tripStatus, type Trip } from '../core/trip';
import { useTrips } from '../trips';
import { log } from './log';
import { askNotifications } from './notifications';
import { keepPlan, planRoute, routeJson } from './planTrip';

const RETRY_MS = 10 * 60_000;
const GAP_MS = 3000;

export function watchAutoPlan() {
  const failed = new Map<string, number>();
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const due = (t: Trip, now: number) =>
    !isPlanned(t) &&
    t.route.waypoints.length >= 2 &&
    tripStatus(t, now) === 'upcoming' &&
    (failed.get(`${t.id}|${routeJson(t)}`) ?? 0) <= now - RETRY_MS;
  const next = (ms = GAP_MS) => {
    clearTimeout(timer);
    timer = setTimeout(() => void step(), ms);
  };
  async function step() {
    if (busy || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const now = Date.now();
    const t = useTrips.getState().trips.find((x) => due(x, now));
    if (!t) {
      // Nothing due now: wake for the first failed trip whose ten minutes are up.
      const first = Math.min(...failed.values());
      if (Number.isFinite(first)) next(Math.max(GAP_MS, first + RETRY_MS - now));
      return;
    }
    busy = true;
    const json = routeJson(t);
    log('autoplan', { trip: t.id, date: t.route.date });
    try {
      // No connection found is a failure too, tried again later; not at once, in a loop.
      if (keepPlan(t.id, json, await planRoute(t))) void askNotifications();
      else failed.set(`${t.id}|${json}`, Date.now());
    } catch (e) {
      log('autoplan.fail', { trip: t.id, e, retryMin: RETRY_MS / 60_000 });
      failed.set(`${t.id}|${json}`, Date.now());
    } finally {
      busy = false;
      next();
    }
  }
  const off = useTrips.subscribe((s, p) => s.trips !== p.trips && next());
  const online = () => {
    failed.clear();
    next();
  };
  window.addEventListener('online', online);
  next();
  return () => {
    off();
    clearTimeout(timer);
    window.removeEventListener('online', online);
  };
}
