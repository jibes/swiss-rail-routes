// Writes route links (`#/r/…`, `#/tour/<id>?s=…`): the app only reads them now (links from
// 0.3 and earlier), so the writer lives with the tests that check the reader.
import { fold } from '../../src/core/stops';
import type { Tour, Waypoint } from '../../src/core/model';

const SLOID = /^ch:1:sloid:(\d+)$/;
const slug = (name: string) => fold(name).replaceAll(' ', '-');
const hhmm = (time: string) => time.replace(':', '');

function code(ref: string): string {
  const m = SLOID.exec(ref);
  return m ? m[1]! : 'x' + encodeURIComponent(ref).replaceAll('.', '%2E').replaceAll('~', '%7E');
}

/** The 0.3 builder's time windows, written into links until 0.15.0; the app reads past them. */
export type OldWaypoint = Waypoint & {
  earliestArr?: string;
  latestDep?: string;
  leaveBy?: string;
  arriveAfter?: string;
};

function token(w: OldWaypoint): string {
  const mods: string[] = [];
  if (w.kind === 'stop') mods.push(String(w.dwellMin));
  if (w.kind === 'turnaround') mods.push(`t${w.dwellMin}`);
  if (w.templateId) mods.push(`@${w.templateId}`);
  if (w.earliestArr) mods.push(`a${hhmm(w.earliestArr)}`);
  if (w.latestDep) mods.push(`b${hhmm(w.latestDep)}`);
  if (w.arriveAfter) mods.push(`f${hhmm(w.arriveAfter)}`);
  if (w.leaveBy) mods.push(`u${hhmm(w.leaveBy)}`);
  return [slug(w.name), code(w.stopRef), ...mods].join('.');
}

/**
 * The route's stops and settings as link parts (defaults left out). A route is where you go;
 * `when` adds date, time and ticket (the plan screen's address).
 */
export function routeParts(
  tour: Omit<Tour, 'waypoints'> & { waypoints: OldWaypoint[] },
  when = false,
): { stops: string; query: URLSearchParams } {
  const q = new URLSearchParams();
  if (when) {
    q.set('d', tour.date);
    if ('arriveBy' in tour.anchor) q.set('arr', tour.anchor.arriveBy);
    else if (tour.anchor.departAt !== '08:00') q.set('dep', tour.anchor.departAt);
    if (tour.ticket !== 'GA') q.set('ticket', tour.ticket);
    if (tour.travelClass !== 2) q.set('class', String(tour.travelClass));
  }
  if (tour.name) q.set('name', tour.name);
  if (tour.notes) q.set('notes', tour.notes);
  return { stops: tour.waypoints.map(token).join('~'), query: q };
}

/** Like URLSearchParams.toString, but leaves `~ @ : /` readable (all allowed in a fragment). */
const qs = (pairs: Iterable<[string, string]>) =>
  [...pairs]
    .map(
      ([k, v]) =>
        `${k}=${encodeURIComponent(v).replace(/%(7E|40|3A|2F)/g, (m) => decodeURIComponent(m))}`,
    )
    .join('&');

const withQuery = (path: string, q: URLSearchParams) => {
  const s = qs(q);
  return s ? `${path}?${s}` : path;
};

/** The share link's hash: the route on any device (with `when`, also date, time, ticket). */
export function routeHash(tour: Tour, when = false): string {
  const { stops, query } = routeParts(tour, when);
  return withQuery(`#/r/${stops}`, query);
}

/**
 * The address of a route on this device (`#/tour/<id><sub>?s=…`): opens it here, and anywhere
 * else as the same route to save, so the address bar is a share link too.
 */
export function tourHash(tour: Tour, sub = ''): string {
  const { stops, query } = routeParts(tour, sub === '/plan');
  return `#/tour/${tour.id}${sub}?${qs([['s', stops], ...query])}`;
}
