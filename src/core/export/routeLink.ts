// Readable route links (`#/r/<stops>?<settings>`), no server involved.
//
//   #/r/zurich-hb.3000~chur.9000.60~@bernina~tirano.9257?d=2026-11-14&dep=08:00
//
// Stops are `~`-separated: `<slug>.<code>` plus `.`-modifiers. The code is the SLOID number
// (`ch:1:sloid:<n>`), or `x` and the percent-encoded ref for anything else; the slug is only
// for people (names come from the stop index). Modifiers: `<min>` get off for that long,
// `t<min>` turn there, `@<template>` part of that route template, `a<hhmm>` arrive no earlier,
// `b<hhmm>` leave no later. `@<template>` alone (`.r` reversed) inserts a route template.
// Settings, each optional: d (date, default today), dep or arr (time, default dep=08:00),
// ticket (default GA), class (default 2), name, notes.
import type { RouteTemplate } from '../data';
import { insertTemplate } from '../edit';
import type { TicketType, Tour, Waypoint } from '../model';
import { fold } from '../stops';

const SLOID = /^ch:1:sloid:(\d+)$/;
const TICKETS: TicketType[] = ['GA', 'Tageskarte', 'Halbtax', 'none'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const slug = (name: string) => fold(name).replaceAll(' ', '-');
const hhmm = (time: string) => time.replace(':', '');
const time = (s: string) => `${s.slice(0, 2)}:${s.slice(2, 4)}`;

function code(ref: string): string {
  const m = SLOID.exec(ref);
  return m ? m[1]! : 'x' + encodeURIComponent(ref).replaceAll('.', '%2E').replaceAll('~', '%7E');
}

function token(w: Waypoint): string {
  const mods: string[] = [];
  if (w.kind === 'stop') mods.push(String(w.dwellMin));
  if (w.kind === 'turnaround') mods.push(`t${w.dwellMin}`);
  if (w.templateId) mods.push(`@${w.templateId}`);
  if (w.earliestArr) mods.push(`a${hhmm(w.earliestArr)}`);
  if (w.latestDep) mods.push(`b${hhmm(w.latestDep)}`);
  return [slug(w.name), code(w.stopRef), ...mods].join('.');
}

/** The route's stops and settings as link parts (defaults left out). */
export function routeParts(tour: Tour): { stops: string; query: URLSearchParams } {
  const q = new URLSearchParams();
  q.set('d', tour.date);
  if ('arriveBy' in tour.anchor) q.set('arr', tour.anchor.arriveBy);
  else if (tour.anchor.departAt !== '08:00') q.set('dep', tour.anchor.departAt);
  if (tour.ticket !== 'GA') q.set('ticket', tour.ticket);
  if (tour.travelClass !== 2) q.set('class', String(tour.travelClass));
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

/** The share link's hash: the route on any device. */
export function routeHash(tour: Tour): string {
  const { stops, query } = routeParts(tour);
  return withQuery(`#/r/${stops}`, query);
}

/**
 * The address of a route on this device (`#/tour/<id><sub>?s=…`): opens it here, and anywhere
 * else as the same route to save, so the address bar is a share link too.
 */
export function tourHash(tour: Tour, sub = ''): string {
  const { stops, query } = routeParts(tour);
  return `#/tour/${tour.id}${sub}?${qs([['s', stops], ...query])}`;
}

export interface LinkContext {
  templates: RouteTemplate[];
  /** The stop's name where known (stop index), else the slug stands in. */
  name: (ref: string) => string | undefined;
  today: string;
}

const unslug = (s: string) =>
  s
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

function refOf(c: string): string | null {
  if (/^\d+$/.test(c)) return `ch:1:sloid:${c}`;
  if (c.startsWith('x') && c.length > 1)
    try {
      return decodeURIComponent(c.slice(1));
    } catch {
      return null;
    }
  return null;
}

/** Reads `<stops>` and its settings back into a route (without id); null if unreadable. */
export function parseRoute(
  stops: string,
  query: URLSearchParams,
  ctx: LinkContext,
): Omit<Tour, 'id'> | null {
  const arr = query.get('arr');
  const dep = query.get('dep');
  const d = query.get('d');
  const ticket = query.get('ticket') as TicketType | null;
  let tour: Tour = {
    id: '',
    name: query.get('name') ?? '',
    date: d && DATE.test(d) ? d : ctx.today,
    anchor:
      arr && TIME.test(arr)
        ? { arriveBy: arr }
        : { departAt: dep && TIME.test(dep) ? dep : '08:00' },
    ticket: ticket && TICKETS.includes(ticket) ? ticket : 'GA',
    travelClass: query.get('class') === '1' ? 1 : 2,
    waypoints: [],
    schema: 1,
  };
  const notes = query.get('notes');
  if (notes) tour.notes = notes;
  for (const tok of stops.split('~').filter(Boolean)) {
    if (tok.startsWith('@')) {
      const [id, dir] = tok.slice(1).split('.');
      const template = ctx.templates.find((x) => x.id === id);
      if (!template) return null;
      tour = insertTemplate(tour, template, dir === 'r');
      continue;
    }
    const [s = '', c = '', ...mods] = tok.split('.');
    const ref = refOf(c);
    if (!ref) return null;
    const w: Waypoint = {
      stopRef: ref,
      name: ctx.name(ref) ?? (unslug(s) || ref),
      kind: 'via',
      dwellMin: 0,
    };
    for (const m of mods) {
      if (/^\d+$/.test(m)) Object.assign(w, { kind: 'stop', dwellMin: Number(m) });
      else if (/^t\d+$/.test(m))
        Object.assign(w, { kind: 'turnaround', dwellMin: Number(m.slice(1)) });
      else if (m.startsWith('@') && ctx.templates.some((x) => x.id === m.slice(1)))
        w.templateId = m.slice(1);
      else if (/^a\d{4}$/.test(m) && TIME.test(time(m.slice(1)))) w.earliestArr = time(m.slice(1));
      else if (/^b\d{4}$/.test(m) && TIME.test(time(m.slice(1)))) w.latestDep = time(m.slice(1));
    }
    tour = { ...tour, waypoints: [...tour.waypoints, w] };
  }
  const wps = tour.waypoints;
  if (wps.length < 2) return null;
  const { id: _id, ...rest } = tour;
  return {
    ...rest,
    waypoints: wps.map((w, i) => {
      const kind = i === 0 ? 'start' : i === wps.length - 1 ? 'end' : w.kind;
      return kind === w.kind ? w : { ...w, kind, dwellMin: 0 };
    }),
  };
}
