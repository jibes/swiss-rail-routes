// The trip as you edit it (SPEC §3a, 0.4.0): the stations you entered, and between two of them
// maybe a scenic line, whose must-pass stations ("rings") belong to the line, not to you.
// Every edit works on entries and rebuilds the waypoints, so a line never survives a change to
// the stations at its two ends.
import { normalise } from './edit';
import type { Tour, Waypoint } from './model';

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
  if (waypoints.some((w) => w.ring)) return waypoints;
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
    for (let k = i + 1; k < end; k++) if (out[k]!.kind === 'via') out[k]!.ring = true;
    i = end > j ? end : j + 1;
  }
  return out;
}

export function entriesOf(tour: Pick<Tour, 'waypoints'>): Entry[] {
  const out: Entry[] = [];
  let rings: Waypoint[] = [];
  for (const w of markRings(tour.waypoints)) {
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
  entries.forEach((e, k) => {
    if (k > 0)
      for (const r of e.rings) waypoints.push({ ...r, kind: 'via', dwellMin: 0, ring: true });
    const { ring: _r, ...w } = e.w;
    waypoints.push(w);
  });
  return { ...tour, waypoints: normalise(waypoints) };
}

/** The template id of the line that leads to entry `k`, if one does. */
export const lineTo = (entries: Entry[], k: number) =>
  k > 0 ? entries[k]?.rings[0]?.templateId : undefined;

const cut = (entries: Entry[], k: number) => {
  if (entries[k]) entries[k] = { ...entries[k]!, rings: [] };
};

/** Moves entry `from` to position `to`; lines into it, out of it and across the gap it lands in go. */
export function moveEntry<T extends Pick<Tour, 'waypoints'>>(tour: T, from: number, to: number): T {
  const e = entriesOf(tour);
  if (from === to || !e[from] || to < 0 || to >= e.length) return tour;
  cut(e, from + 1);
  const [item] = e.splice(from, 1);
  e.splice(to, 0, { ...item!, rings: [] });
  cut(e, to + 1);
  return fromEntries(tour, e);
}

export function removeEntry<T extends Pick<Tour, 'waypoints'>>(tour: T, k: number): T {
  const e = entriesOf(tour);
  if (!e[k]) return tour;
  cut(e, k + 1);
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
  const end = (s: { ref: string; name: string }): Waypoint => ({
    stopRef: s.ref,
    name: s.name,
    kind: 'via',
    dwellMin: 0,
    templateId: template.id,
  });
  return [
    { w: end(first), rings: [] },
    { w: end(last), rings },
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
  e[k] = {
    w: { ...x.w, stopRef: stop.stopRef, name: stop.name, templateId: undefined },
    rings: [],
  };
  cut(e, k + 1);
  return fromEntries(tour, e);
}

/** Pass through (null), change trains (0) or stay that many minutes at entry `k`. */
export function setEntryStay<T extends Pick<Tour, 'waypoints'>>(
  tour: T,
  k: number,
  stay: number | null,
): T {
  const e = entriesOf(tour);
  const x = e[k];
  if (!x || k === 0 || k === e.length - 1) return tour;
  e[k] = {
    ...x,
    w: { ...x.w, kind: stay === null ? 'via' : 'stop', dwellMin: stay === null ? 0 : stay },
  };
  return fromEntries(tour, e);
}

/** Goes to entry `k` without the scenic line that leads there. */
export function dropLine<T extends Pick<Tour, 'waypoints'>>(tour: T, k: number): T {
  const e = entriesOf(tour);
  if (!e[k]?.rings.length) return tour;
  cut(e, k);
  return fromEntries(tour, e);
}

/** The template ids whose lines a move of entry `from` to `to` would switch off. */
export function linesLostByMove(tour: Pick<Tour, 'waypoints'>, from: number, to: number): string[] {
  const before = entriesOf(tour);
  const after = entriesOf(moveEntry(tour, from, to));
  const ids = (e: Entry[]) =>
    new Set(e.flatMap((x) => (x.rings[0]?.templateId ? [x.rings[0].templateId] : [])));
  const kept = ids(after);
  return [...ids(before)].filter((id) => !kept.has(id));
}

/** Same stations, same stays, same lines: the key that makes two routes one in search. */
export const routeKey = (tour: Pick<Tour, 'waypoints'>) =>
  markRings(tour.waypoints)
    .map((w) => `${w.stopRef}|${w.kind}|${w.dwellMin}|${w.ring ? (w.templateId ?? '') : ''}`)
    .join(';');
