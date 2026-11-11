// The trip as you edit it (SPEC §3a, 0.4.0): the stations you entered, and between two of them
// maybe a scenic line, whose must-pass stations ("rings") belong to the line, not to you.
// Every edit works on entries and rebuilds the waypoints, so a line never survives a change to
// the stations at its two ends. A line is recorded on its end (`Waypoint.line`): the station
// it leads to. Its start is just the station before, so a station can end one line and start
// the next.
import { normalise } from './edit';
import type { Tour, Waypoint } from './model';
import { stopKey } from './stops';

export interface Entry {
  w: Waypoint;
  /** The line's stations on the way here from the entry before, if a line leads here. */
  rings: Waypoint[];
}

/**
 * Marks the must-pass stations inside each line as rings, for tours saved before 0.4.0. A line
 * is a run of waypoints with one templateId; its first and last stations are entries. Where a
 * second line was added straight after a first, the shared station carries the second line's id
 * (insertTemplate before 0.4.0), so it ends the first run too.
 */
export function markRings(waypoints: Waypoint[]): Waypoint[] {
  if (waypoints.some((w) => w.ring || w.line)) return waypoints;
  const out = waypoints.map((w) => ({ ...w }));
  let i = 0;
  while (i < out.length) {
    const id = out[i]!.templateId;
    if (!id) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < out.length && out[j + 1]!.templateId === id) j++;
    // The run i..j; its end is j, or the station after it when that one starts another line.
    const next = out[j + 1];
    const end = next?.templateId && next.templateId !== id ? j + 1 : j;
    // The same line out and back is one run too: where it turns (the stations on either side
    // the same) is an end of its own, not one of the line's stations.
    const turns = (k: number) => out[k - 1]?.stopRef === out[k + 1]?.stopRef;
    for (let k = i + 1; k < end; k++) if (out[k]!.kind === 'via' && !turns(k)) out[k]!.ring = true;
    i = end > j ? end : j + 1;
  }
  return out;
}

/**
 * The waypoints with each line on its end (`line`). Routes saved before 0.8.1 tagged both ends
 * and the rings with the line's templateId: a line leads to a station when the one before it is
 * one of the line's rings, or carries the same tag (a line without rings).
 */
export function withLines(waypoints: Waypoint[]): Waypoint[] {
  if (waypoints.some((w) => w.line)) return waypoints;
  const out = markRings(waypoints).map((w) => ({ ...w }));
  for (let i = 1; i < out.length; i++) {
    const w = out[i]!;
    const prev = out[i - 1]!;
    if (w.ring || !prev.templateId) continue;
    if (prev.ring || w.templateId === prev.templateId) w.line = prev.templateId;
  }
  return out;
}

/** Every scenic line the route rides (by its rings or its end). */
export const linesOf = (waypoints: Waypoint[]): Set<string> =>
  new Set(
    withLines(waypoints).flatMap((w) =>
      w.ring && w.templateId ? [w.templateId] : w.line ? [w.line] : [],
    ),
  );

export function entriesOf(tour: Pick<Tour, 'waypoints'>): Entry[] {
  const out: Entry[] = [];
  let rings: Waypoint[] = [];
  for (const w of withLines(tour.waypoints)) {
    if (w.ring && out.length) rings.push(w);
    else {
      out.push({ w: { ...w, ring: undefined }, rings });
      rings = [];
    }
  }
  return out;
}

export function fromEntries<T extends Pick<Tour, 'waypoints'>>(tour: T, entries: Entry[]): T {
  const waypoints: Waypoint[] = [];
  // The tags older versions read (both ends of a line): written, never read back here.
  const tag = entries.map((): string | undefined => undefined);
  entries.forEach((e, k) => {
    const line = k > 0 ? e.w.line : undefined;
    if (line) {
      tag[k] = line;
      tag[k - 1] ??= line;
    }
  });
  entries.forEach((e, k) => {
    const line = k > 0 ? e.w.line : undefined;
    if (k > 0)
      for (const r of line ? e.rings : [])
        waypoints.push({ ...r, kind: 'via', dwellMin: 0, ring: true, templateId: line });
    const { ring: _r, line: _l, templateId: _t, ...w } = e.w;
    waypoints.push({
      ...w,
      ...(line ? { line } : {}),
      ...(tag[k] ? { templateId: tag[k] } : {}),
    });
  });
  return { ...tour, waypoints: normalise(waypoints) };
}

/** The template id of the line that leads to entry `k`, if one does. */
export const lineTo = (entries: Entry[], k: number): string | undefined =>
  k > 0 ? entries[k]?.w.line : undefined;

/** Cuts the line that leads to entry `k`: its rings and its mark on the end go. */
const cut = (entries: Entry[], k: number) => {
  const e = entries[k];
  if (!e) return;
  entries[k] = { w: { ...e.w, line: undefined }, rings: [] };
};

/** Moves entry `from` to position `to`; lines into it, out of it and across the gap it lands in go. */
export function moveEntry<T extends Pick<Tour, 'waypoints'>>(tour: T, from: number, to: number): T {
  const e = entriesOf(tour);
  if (from === to || !e[from] || to < 0 || to >= e.length) return tour;
  // Lines into it and out of it go: a line is its two ends.
  cut(e, from + 1);
  cut(e, from);
  const [item] = e.splice(from, 1);
  // The line across the gap it lands in goes too: the station after the gap is `to` now.
  cut(e, to);
  e.splice(to, 0, item!);
  return fromEntries(tour, e);
}

export function removeEntry<T extends Pick<Tour, 'waypoints'>>(tour: T, k: number): T {
  const e = entriesOf(tour);
  if (!e[k]) return tour;
  cut(e, k + 1);
  cut(e, k);
  e.splice(k, 1);
  return fromEntries(tour, e);
}

/** Inserts entries after entry `k` (-1: at the start); the line across that gap goes. */
export function insertEntries<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
  k: number,
  add: Entry[],
): T {
  const e = entriesOf(tour);
  let list = add;
  // A station already there is not added twice: a line starting where you are continues it.
  const here = e[k];
  if (here && list[0] && list[0].w.stopRef === here.w.stopRef) list = list.slice(1);
  if (!list.length) return tour;
  cut(e, k + 1);
  // A line that ends where the next station is: it leads there, the station stays as it was.
  const after = e[k + 1];
  const last = list.at(-1)!;
  if (after && last.w.stopRef === after.w.stopRef) {
    e[k + 1] = { w: { ...after.w, line: last.w.line }, rings: last.rings };
    list = list.slice(0, -1);
  }
  e.splice(k + 1, 0, ...list);
  return fromEntries(tour, e);
}

/** A station by itself; new stations are ridden through until you say otherwise. */
export const stationEntry = (stop: Pick<Waypoint, 'stopRef' | 'name'>): Entry => ({
  w: { stopRef: stop.stopRef, name: stop.name, kind: 'via', dwellMin: 0 },
  rings: [],
});

/**
 * A scenic line as two entries, its start and its end, the must-pass stations between them as
 * the end's rings. `reversed` runs it end to start.
 */
export function lineEntries(
  template: { id: string; chain: { ref: string; name: string }[]; mustPass: string[] },
  reversed = false,
): Entry[] {
  const chain = reversed ? [...template.chain].reverse() : template.chain;
  const must = new Set(template.mustPass);
  const first = chain[0]!;
  const last = chain.at(-1)!;
  const rings = chain
    .slice(1, -1)
    .filter((s) => must.has(s.ref))
    .map((s): Waypoint => ({
      stopRef: s.ref,
      name: s.name,
      kind: 'via',
      dwellMin: 0,
      templateId: template.id,
      ring: true,
    }));
  const at = (s: { ref: string; name: string }): Waypoint => ({
    stopRef: s.ref,
    name: s.name,
    kind: 'via',
    dwellMin: 0,
  });
  return [
    { w: at(first), rings: [] },
    { w: { ...at(last), line: template.id }, rings },
  ];
}

/** Another station in place of entry `k`; whether you get off there and how long stays. */
export function replaceEntry<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
  k: number,
  stop: Pick<Waypoint, 'stopRef' | 'name'>,
): T {
  const e = entriesOf(tour);
  const x = e[k];
  if (!x) return tour;
  cut(e, k);
  cut(e, k + 1);
  e[k] = {
    w: { ...e[k]!.w, stopRef: stop.stopRef, name: stop.name },
    rings: [],
  };
  return fromEntries(tour, e);
}

/** Pass through (null), or get off at entry `k` and stay that many minutes. */
export function setEntryStay<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
  k: number,
  stay: number | null,
): T {
  const e = entriesOf(tour);
  const x = e[k];
  if (!x || k === 0 || k === e.length - 1) return tour;
  // Riding through, there is no stay to end by a time. A length given is the stay's intent
  // (0.51.0): a time it ended by (until, leave by) goes, as the panel says the two as one.
  const { leaveBy: _l, arriveAfter: _a, stayUntil: _u, ...through } = x.w;
  const { leaveBy: _l2, stayUntil: _u2, ...kept } = x.w;
  e[k] = {
    ...x,
    w:
      stay === null
        ? { ...through, kind: 'via', dwellMin: 0 }
        : { ...kept, kind: 'stop', dwellMin: stay },
  };
  return fromEntries(tour, e);
}

/** Entry `k`'s stay to end by `hhmm` (the place closes), or at any time (null). */
export function setEntryLeaveBy<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
  k: number,
  hhmm: string | null,
): T {
  const e = entriesOf(tour);
  const x = e[k];
  if (!x || x.w.kind !== 'stop') return tour;
  const { leaveBy: _l, ...w } = x.w;
  e[k] = { ...x, w: hhmm ? { ...w, leaveBy: hhmm } : w };
  return fromEntries(tour, e);
}

/** Goes to entry `k` without the scenic line that leads there. */
export function dropLine<T extends Pick<Tour, 'waypoints'>>(tour: T, k: number): T {
  const e = entriesOf(tour);
  if (!lineTo(e, k)) return tour;
  cut(e, k);
  return fromEntries(tour, e);
}

/** A stay until a time: its length beside it, the least a stop can be. */
export const UNTIL_DWELL = 1;
/** A stay's length when it is first made, or when its time goes. */
export const DEFAULT_STAY = 30;
/** A stay's length once its time to end goes: the time's own length stood for nothing. */
const lengthWithout = (w: Waypoint) =>
  w.stayUntil && w.dwellMin <= UNTIL_DWELL ? DEFAULT_STAY : w.dwellMin;

/**
 * Entry `k`'s stay to end at a date and time (`YYYY-MM-DDTHH:MM`), or as long as its stay. A
 * time given is the stay's intent (0.51.0): its length is then the least (`UNTIL_DWELL`), so the
 * next train leaves at that time, or as soon as it can when the stop is reached later; a time to
 * leave by goes.
 */
export function setEntryStayUntil<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
  k: number,
  until: string | null,
): T {
  const e = entriesOf(tour);
  const x = e[k];
  if (!x || x.w.kind !== 'stop') return tour;
  const { stayUntil: _u, ...w } = x.w;
  const { leaveBy: _l, ...timed } = w;
  e[k] = {
    ...x,
    w: until
      ? { ...timed, dwellMin: UNTIL_DWELL, stayUntil: until }
      : { ...w, dwellMin: lengthWithout(x.w) },
  };
  return fromEntries(tour, e);
}

/**
 * The route the other way round: the stations in reverse order (a round trip, starting and
 * ending at one station, runs its loop the other way from the same start), each line on its
 * new end with its stations reversed, stays with their stations. A stay's window (leave by,
 * arrive after) does not fit the new order and goes; `windowsDropped` says whether one did.
 * Reversing twice gives the route back.
 */
export function reverseRoute<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
): { tour: T; windowsDropped: boolean } {
  const e = entriesOf(tour);
  let windowsDropped = false;
  const out: Entry[] = e
    .map((x, k) => {
      const { leaveBy, arriveAfter, stayUntil, line: _l, ...w } = x.w;
      if (leaveBy || arriveAfter || stayUntil) windowsDropped = true;
      // The line that led here from the entry before now leads from here to it: it is
      // recorded on that entry, reversed.
      const next = e[k + 1];
      const into = next?.w.line;
      return {
        w: { ...w, dwellMin: lengthWithout(x.w), ...(into ? { line: into } : {}) },
        rings: into ? [...next.rings].reverse() : [],
      };
    })
    .reverse();
  return { tour: fromEntries(tour, out), windowsDropped };
}

/**
 * The way back the same way (SPEC §3, 0.47.0): from the route's last station to its first by
 * the stations and lines of the way out, reversed, ridden through (the stays were on the way
 * out). Empty when there is nothing to retrace: no station between, or back at the start.
 */
export function sameWayBack(tour: Pick<Tour, 'waypoints'>): Entry[] {
  const e = entriesOf(tour);
  if (e.length < 3 || stopKey(e[0]!.w.stopRef) === stopKey(e.at(-1)!.w.stopRef)) return [];
  return entriesOf(reverseRoute(tour).tour)
    .slice(1)
    .map((x) => {
      const { leaveBy: _l, arriveAfter: _a, stayUntil: _u, ...w } = x.w;
      return { ...x, w: { ...w, kind: 'via' as const, dwellMin: 0 } };
    });
}

/** The template ids whose lines a move of entry `from` to `to` would switch off. */
export function linesLostByMove(tour: Pick<Tour, 'waypoints'>, from: number, to: number): string[] {
  const before = entriesOf(tour);
  const after = entriesOf(moveEntry(tour, from, to));
  const ids = (e: Entry[]) => new Set(e.flatMap((_, k) => lineTo(e, k) ?? []));
  const kept = ids(after);
  return [...ids(before)].filter((id) => !kept.has(id));
}

/** Same stations, same stays, same lines: the key that makes two routes one in search. */
export const routeKey = (tour: Pick<Tour, 'waypoints'>) =>
  withLines(tour.waypoints)
    .map(
      (w) =>
        `${stopKey(w.stopRef)}|${w.kind}|${w.dwellMin}|${w.ring ? (w.templateId ?? '') : (w.line ?? '')}`,
    )
    .join(';');
