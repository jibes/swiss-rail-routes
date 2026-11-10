// A `plan_trip` request as the app's route: stations and scenic lines, in the app's own terms.
import type { RouteTemplate } from '../../src/core/data';
import { lineEntries, stationEntry, fromEntries, type Entry } from '../../src/core/line';
import { lineReversed } from '../../src/core/lineDirection';
import type { Anchor, TicketType, Tour, Waypoint } from '../../src/core/model';
import { fold, stopKey, type Stop, type StopSearch } from '../../src/core/stops';
import { dayOf } from '../../src/core/trip';
import { zurichLocal } from '../../src/core/planner/plan';

/** A request the caller can correct: said as it is. */
export class ToolError extends Error {}

export interface StopInput {
  ref?: string;
  name?: string;
  /** Minutes to get off for; 0 or left out rides through (or changes, as the plan needs). */
  stay?: number;
  line?: string;
  /** Leave by then (`HH:MM`): the place closes. */
  leaveBy?: string;
  /** Not there before then (`HH:MM`): the place opens. */
  arriveAfter?: string;
  /** Stay until then (`YYYY-MM-DDTHH:MM`, Zurich), also on a later day. */
  stayUntil?: string;
}

export interface RouteInput {
  date?: string;
  departAt?: string;
  arriveBy?: string;
  stops: StopInput[];
  roundTrip?: boolean;
  /**
   * A round trip's way back: only what is listed, with nothing listed the fastest (`as_listed`,
   * default); the fastest home after the last stay (`fastest`); or the way out reversed, its
   * lines included (`same_way`).
   */
  returnWay?: 'fastest' | 'as_listed' | 'same_way';
  ticket?: TicketType;
}

export const MAX_STOPS = 12;
const MAX_DAYS_AHEAD = 400;
const DAY = 86_400_000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UNTIL = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveStop(s: StopInput, index: StopSearch): Stop {
  if (s.ref) {
    const hit = index.byRef(stopKey(s.ref));
    if (!hit) throw new ToolError(`unknown stop: ${s.ref}`);
    // A station abroad (find_stops with abroad): its ref says where it is, not what it is called.
    if (s.ref.startsWith('eu:')) {
      if (!s.name) throw new ToolError(`a station abroad needs its name too: ${s.ref}`);
      return { ...hit, name: s.name };
    }
    return hit;
  }
  const hit = s.name ? index.search(s.name, 1)[0] : undefined;
  if (!hit) throw new ToolError(`unknown stop: ${s.name ?? '(no name or ref)'}`);
  return hit;
}

const asDate = (d: string) => Date.parse(`${d}T12:00:00Z`);

export function resolveWhen(
  input: Pick<RouteInput, 'date' | 'departAt' | 'arriveBy'>,
  now: number,
): { date: string; anchor: Anchor } {
  const today = dayOf(now);
  const { departAt, arriveBy } = input;
  if (departAt && arriveBy) throw new ToolError('give departAt or arriveBy, not both');
  for (const t of [departAt, arriveBy])
    if (t && !TIME.test(t)) throw new ToolError(`not a time (HH:MM): ${t}`);
  const soon = zurichLocal(now + 5 * 60_000);
  const date = input.date ?? (departAt || arriveBy ? today : soon.slice(0, 10));
  if (!DATE.test(date) || Number.isNaN(asDate(date))) throw new ToolError(`not a date: ${date}`);
  if (date < today) throw new ToolError(`date ${date} has passed`);
  if (asDate(date) - asDate(today) > MAX_DAYS_AHEAD * DAY)
    throw new ToolError(`date ${date} is too far ahead`);
  if (arriveBy) {
    if (date === today && arriveBy <= zurichLocal(now).slice(11, 16))
      throw new ToolError(`arriveBy ${arriveBy} has passed today`);
    return { date, anchor: { arriveBy } };
  }
  if (date !== today && date !== soon.slice(0, 10))
    return { date, anchor: { departAt: departAt ?? '08:00' } };
  // On today's date, never before now.
  const earliest = soon.slice(0, 10) === date ? soon.slice(11, 16) : '00:00';
  return { date, anchor: { departAt: !departAt || departAt < earliest ? earliest : departAt } };
}

export function buildRoute(
  input: RouteInput,
  deps: { index: StopSearch; templates: RouteTemplate[]; now: number },
): Tour {
  const { index, templates, now } = deps;
  const listed = input.stops;
  if (listed.length > MAX_STOPS) throw new ToolError(`at most ${MAX_STOPS} stops`);
  // The way out reversed, lines included, without its stays (round 3, R3-16: as_listed came
  // back the fastest way, as it lists nothing for the way back).
  const sameWay = input.returnWay === 'same_way';
  if (sameWay && !input.roundTrip) throw new ToolError('returnWay needs roundTrip');
  // A stay where the trip starts or ends has nothing to wait for (round 3, 6 Nov 2026: it was
  // left out without a word). With roundTrip the last listed station is a turn, not the end.
  const end = listed.at(-1);
  if ((listed[0]?.stay ?? 0) > 0 || (!input.roundTrip && (end?.stay ?? 0) > 0 && listed.length > 1))
    throw new ToolError(
      'A stay at the start or the end has no effect: put it on a station in between.',
    );
  const back = sameWay
    ? (end?.line ? listed : listed.slice(0, -1))
        .slice()
        .reverse()
        .map((x): StopInput => ({
          ...(x.ref ? { ref: x.ref } : {}),
          ...(x.name ? { name: x.name } : {}),
          ...(x.line ? { line: x.line } : {}),
        }))
    : [];
  const items = [...listed, ...back];
  const stations = items.map((s) => (s.line ? undefined : resolveStop(s, index)));
  const entries: Entry[] = [];
  items.forEach((s, i) => {
    if (s.line) {
      const t = templates.find((x) => x.id === s.line);
      if (!t) throw new ToolError(`unknown scenic line: ${s.line}`);
      const before = entries.at(-1);
      const beforeStop = before ? index.byRef(stopKey(before.w.stopRef)) : undefined;
      const next = stations[i + 1];
      const reversed = lineReversed(
        t,
        {
          before: before && { ref: before.w.stopRef, at: beforeStop },
          after: next && { ref: next.ref, at: next },
        },
        (r) => index.byRef(stopKey(r)),
      );
      const line = lineEntries(t, reversed);
      // Already at its start: it continues from here.
      entries.push(
        ...(before && stopKey(before.w.stopRef) === stopKey(line[0]!.w.stopRef)
          ? line.slice(1)
          : line),
      );
      return;
    }
    const stop = stations[i]!;
    const until = s.stayUntil;
    if (until !== undefined && !UNTIL.test(until))
      throw new ToolError(`not a date and time (YYYY-MM-DDTHH:MM): ${until}`);
    // Staying until a time is a stay: 30 min (the app's Stay here) when none is given.
    const stay = s.stay && s.stay > 0 ? Math.round(s.stay) : until ? 30 : 0;
    const prev = entries.at(-1);
    // The same station listed twice in a row (retest round 3: Zürich HB → Zürich HB was said as
    // "needs at least two stations"). After a line ending there it is that end, with its stay.
    const same = (x?: { ref: string }) => !!x && stopKey(x.ref) === stopKey(stop.ref);
    if (i > 0 && !items[i - 1]!.line && same(stations[i - 1]))
      throw new ToolError(
        items.length === 2
          ? 'Start and end are the same station: use roundTrip, or add a station between.'
          : `${stop.name} is listed twice in a row: leave one out, or add a station between.`,
      );
    // A station a line just ended at: that end, now with its stay.
    const entry =
      prev && stopKey(prev.w.stopRef) === stopKey(stop.ref)
        ? entries.pop()!
        : stationEntry({ stopRef: stop.ref, name: stop.name });
    for (const t of [s.leaveBy, s.arriveAfter])
      if (t !== undefined && !TIME.test(t)) throw new ToolError(`not a time (HH:MM): ${t}`);
    const w: Waypoint = {
      ...(stay ? { ...entry.w, kind: 'stop', dwellMin: stay } : entry.w),
      ...(s.leaveBy ? { leaveBy: s.leaveBy } : {}),
      ...(s.arriveAfter ? { arriveAfter: s.arriveAfter } : {}),
      ...(until ? { stayUntil: until } : {}),
    };
    entries.push({ ...entry, w });
  });
  if (input.roundTrip && !sameWay && entries.length) entries.push(stationEntry(entries[0]!.w));
  if (input.returnWay === 'fastest') {
    if (!input.roundTrip) throw new ToolError('returnWay needs roundTrip');
    // After the last stay, straight home: its stations and lines left out, so the planner
    // takes the fastest way back (scenic out, fast back).
    const last = entries.findLastIndex((e, k) => k < entries.length - 1 && e.w.kind === 'stop');
    if (last < 1) throw new ToolError('returnWay fastest needs a stay to turn at');
    entries.splice(last + 1, entries.length - 1 - (last + 1));
  }
  if (entries.length < 2) throw new ToolError('a trip needs at least two stations');
  const { date, anchor } = resolveWhen(input, now);
  for (const e of entries)
    if (e.w.stayUntil && e.w.stayUntil.slice(0, 10) < date)
      throw new ToolError(`stayUntil ${e.w.stayUntil} is before the trip's day, ${date}`);
  return fromEntries(
    {
      id: 'mcp',
      name: '',
      date,
      anchor,
      ticket: input.ticket ?? 'GA',
      travelClass: 2,
      waypoints: [],
      schema: 1,
    } satisfies Tour,
    entries,
  );
}

/** The route's own link: readable, plans anew in the app (core/export/routeLink.ts). */
export function routeLinkOf(tour: Tour, publicUrl: string): string {
  const stops = tour.waypoints.map((w) => {
    const m = /^ch:1:sloid:(\d+)/.exec(w.stopRef);
    const code = m ? m[1] : `x${encodeURIComponent(w.stopRef)}`;
    const slug = fold(w.name)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return [
      `${slug}.${code}`,
      ...(w.kind === 'stop' ? [String(w.dwellMin)] : []),
      ...(w.templateId ? [`@${w.templateId}`] : []),
      ...(w.arriveAfter ? [`f${w.arriveAfter.replace(':', '')}`] : []),
      ...(w.leaveBy ? [`u${w.leaveBy.replace(':', '')}`] : []),
      ...(w.stayUntil ? [`n${w.stayUntil.replace(/[-T:]/g, '')}`] : []),
    ].join('.');
  });
  const when =
    'departAt' in tour.anchor ? `dep=${tour.anchor.departAt}` : `arr=${tour.anchor.arriveBy}`;
  return `${publicUrl}#/r/${stops.join('~')}?d=${tour.date}&${when}&ticket=${tour.ticket}`;
}
