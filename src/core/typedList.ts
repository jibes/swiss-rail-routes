// Several stops typed at once (SPEC §3, Could; 0.47.0): "Albula, Bernina, back via Vereina" in
// the add sheet becomes one row that adds them all, in the order typed, after the user taps it.
// Matched on the device against the scenic lines and the stop index: nothing is sent anywhere.
// Pure: the line and station lookups are injected.
import type { RouteTemplate } from './data';
import { lineEntries, stationEntry, type Entry } from './line';
import { lineReversed } from './lineDirection';
import type { LatLon, Waypoint } from './model';
import { fold, stopKey } from './stops';

export interface TypedPart {
  text: string;
  /** Said as the way back ("back via Vereina"): the trip returns to its start after the list. */
  back: boolean;
}

const SEPARATOR = /\s*(?:->|[,;+>→]|\s(?:then|and|dann|und|puis|et|poi|quindi)\s)\s*/i;
const BACK =
  /^(?:back|return|zurück|zurueck|retour|ritorno)\b\s*(?:(?:via|by|über|ueber|par|per)\s+)?/i;
const VIA = /^(?:via|by|über|ueber|par|per|to|nach|à|a)\s+/i;

/** The parts of a typed list, or null when it is one thing (the search shows that as ever). */
export function splitTyped(q: string): TypedPart[] | null {
  const parts = q
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const back = BACK.test(p);
      return { text: p.replace(BACK, '').replace(VIA, '').trim(), back };
    })
    // A bare "back" says only that the list returns to the start.
    .filter((p) => p.text.length >= 2 || (p.back && !p.text));
  return parts.length >= 2 ? parts : null;
}

type At = LatLon & { modes?: readonly string[] };

export interface TypedDeps {
  lines: readonly RouteTemplate[];
  /** A line's names to match: its own names first, then the named trains on it. */
  names: (tp: RouteTemplate) => { own: string[]; products: string[] };
  station: (text: string) => Pick<Waypoint, 'stopRef' | 'name'> | undefined;
  stop: (ref: string) => At | undefined;
}

export type TypedItem =
  | { kind: 'station'; stop: Pick<Waypoint, 'stopRef' | 'name'> }
  | { kind: 'line'; template: RouteTemplate; from: string; to: string };

export interface Typed {
  items: TypedItem[];
  /** Parts nothing matched: the row is not offered while there are any. */
  missing: string[];
  entries: Entry[];
}

/**
 * A line by its own name ("Bernina"), else a named train on it ("Glacier Express"); `loose`
 * also by a name's start from four letters ("Brün").
 */
function lineFor(text: string, deps: TypedDeps, loose: boolean): RouteTemplate | undefined {
  const f = fold(text);
  const hit = (n: string) => fold(n) === f || (loose && f.length >= 4 && fold(n).startsWith(f));
  return (
    deps.lines.find((tp) => deps.names(tp).own.some(hit)) ??
    deps.lines.find((tp) => deps.names(tp).products.some(hit))
  );
}

/**
 * The parts matched and turned into entries after `after` (the station added after). A line
 * runs from the end nearer the stop before it (or towards the stop after it, as the add sheet
 * decides); a part said as the way back ends the list at `first`, the trip's start.
 */
export function resolveTyped(
  parts: TypedPart[],
  deps: TypedDeps,
  after?: Pick<Waypoint, 'stopRef' | 'name'>,
  first?: Pick<Waypoint, 'stopRef' | 'name'>,
): Typed {
  const missing: string[] = [];
  const found: (
    | { kind: 'station'; stop: Pick<Waypoint, 'stopRef' | 'name'> }
    | { kind: 'line'; template: RouteTemplate }
  )[] = [];
  for (const p of parts) {
    if (!p.text) continue;
    // A line by its name; a station named just that ("Bern") before a line starting so
    // ("Bernina"); then the line, then the station search's best.
    const st0 = deps.station(p.text);
    const exact = st0 && fold(st0.name) === fold(p.text);
    const tp = lineFor(p.text, deps, false) ?? (exact ? undefined : lineFor(p.text, deps, true));
    const st = tp ? undefined : st0;
    if (tp) found.push({ kind: 'line', template: tp });
    else if (st) found.push({ kind: 'station', stop: st });
    else missing.push(p.text);
  }
  const home =
    parts.some((p) => p.back) && first && found.length
      ? { kind: 'station' as const, stop: first }
      : undefined;
  if (home) found.push(home);

  const items: TypedItem[] = [];
  const entries: Entry[] = [];
  let prev = after?.stopRef;
  found.forEach((x, k) => {
    if (x.kind === 'station') {
      if (prev && stopKey(prev) === stopKey(x.stop.stopRef)) return;
      items.push(x);
      entries.push(stationEntry(x.stop));
      prev = x.stop.stopRef;
      return;
    }
    const next = found[k + 1];
    // A line next: the end the two share, where this one leads (third audit: "Albula +
    // Bernina" ran the Albula away from St. Moritz, where the Bernina starts).
    const ends = (tp: RouteTemplate) => [tp.chain[0]!.ref, tp.chain.at(-1)!.ref].map(stopKey);
    const shared =
      next?.kind === 'line'
        ? [x.template.chain[0]!.ref, x.template.chain.at(-1)!.ref].find((r) =>
            ends(next.template).includes(stopKey(r)),
          )
        : undefined;
    const nextRef = next?.kind === 'station' ? next.stop.stopRef : shared;
    const reversed = lineReversed(
      x.template,
      {
        before: prev ? { ref: prev, at: deps.stop(prev) } : undefined,
        after: nextRef ? { ref: nextRef, at: deps.stop(nextRef) } : undefined,
      },
      deps.stop,
    );
    const e = lineEntries(x.template, reversed);
    // A line starting where the list is already: that station once.
    const own = prev && stopKey(prev) === stopKey(e[0]!.w.stopRef) ? e.slice(1) : e;
    entries.push(...own);
    items.push({
      kind: 'line',
      template: x.template,
      from: e[0]!.w.name,
      to: e.at(-1)!.w.name,
    });
    prev = e.at(-1)!.w.stopRef;
  });
  return { items, missing, entries };
}
