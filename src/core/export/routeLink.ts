// Readable route links (`#/r/<stops>?<settings>`), no server involved.
//
//   #/r/zurich-hb.3000~chur.9000.60~@bernina~tirano.9257   (+ ?d=2026-11-14&dep=08:00 on the plan)
//
// Stops are `~`-separated: `<slug>.<code>` plus `.`-modifiers. The code is the SLOID number
// (`ch:1:sloid:<n>`), or `x` and the percent-encoded ref for anything else; the slug is only
// for people (names come from the stop index). Modifiers: `<min>` get off for that long,
// `t<min>` turn there, `@<template>` part of that route template, `f<hhmm>` not there before
// (it opens) and `u<hhmm>` leave by (it closes; 0.20.0, read past by older versions),
// `n<YYYYMMDDHHMM>` stay until then (0.44.0, several days);
// `a<hhmm>` and `b<hhmm>` (arrive no earlier, leave no later) were written by older links and
// are read past: nothing ever enforced them. `@<template>` alone (`.r` reversed) inserts a route template.
// Settings, each optional: d (date; without one today, or the day of the earliest stay until a
// date when that is later, as the stays name the trip's days: never before today, the stays
// moving with it), dep or arr (time, default dep=08:00),
// ticket (default GA), class (default 2), name, notes.
import type { RouteTemplate } from '../data';
import { insertTemplate, normalise } from '../edit';
import { staysOnDay } from '../stay';
import type { TicketType, Tour, Waypoint } from '../model';

const TICKETS: TicketType[] = ['GA', 'Tageskarte', 'Halbtax', 'none'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * A link without a date whose stays end on a day (audit, 11 Nov 2026: such a link opened today
 * with its stays where they were, gone or days off): the trip goes on the earliest of those days,
 * or today with the stays moved along, when that day is gone.
 */
function undatedStays(tour: Tour, today: string): Tour {
  const days = tour.waypoints.flatMap((w) => (w.stayUntil ? [w.stayUntil.slice(0, 10)] : []));
  if (!days.length) return tour;
  const first = days.reduce((a, b) => (b < a ? b : a));
  if (first >= today) return { ...tour, date: first };
  return { ...tour, date: today, waypoints: staysOnDay(tour.waypoints, first, today) };
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
      else if (/^[fu]([01]\d|2[0-3])[0-5]\d$/.test(m))
        w[m[0] === 'f' ? 'arriveAfter' : 'leaveBy'] = `${m.slice(1, 3)}:${m.slice(3)}`;
      // `n<YYYYMMDDHHMM>`: stay until then (0.44.0, several days).
      else if (/^n\d{8}([01]\d|2[0-3])[0-5]\d$/.test(m))
        w.stayUntil = `${m.slice(1, 5)}-${m.slice(5, 7)}-${m.slice(7, 9)}T${m.slice(9, 11)}:${m.slice(11)}`;
    }
    // A stop right after the same stop (a template's end written out again) is one stop.
    const prev = tour.waypoints.at(-1);
    if (prev?.stopRef === w.stopRef) continue;
    tour = { ...tour, waypoints: [...tour.waypoints, w] };
  }
  if (tour.waypoints.length < 2) return null;
  if (!(d && DATE.test(d))) tour = undatedStays(tour, ctx.today);
  const { id: _id, ...rest } = tour;
  // Start and end where they are now, every station between them kept as what it is.
  const middle = (w: Waypoint): Waypoint =>
    w.kind === 'start' || w.kind === 'end' ? { ...w, kind: 'via', dwellMin: 0 } : w;
  return { ...rest, waypoints: normalise(tour.waypoints.map(middle)) };
}
