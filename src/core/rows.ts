// The one line (SPEC §3a, 0.4.0) as rows: stations and the rides between them. Built from the
// route alone (before it is planned: no times) or from the route and its planned connections.
// Stations you entered carry their entry index (they are the ones you can edit); a scenic line's
// stations are rings; a change the timetable needs on its own is a station without an entry.
import { entriesOf, markRings } from './line';
import type { Connection, Section, Tour, Waypoint } from './model';
import { stopKey } from './stops';

export type StationRole = 'start' | 'end' | 'pass' | 'stop' | 'change';

export interface StationRow {
  type: 'station';
  name: string;
  key: string;
  role: StationRole;
  /** Index into entriesOf(tour): set on stations you entered. */
  entry?: number;
  /** A scenic line's station (part of the line, not yours to edit), and that line's template. */
  ring?: boolean;
  line?: string;
  /** Minutes you stay (a stop you entered). */
  stay?: number;
  arr?: string;
  dep?: string;
  platformArr?: string;
  platformDep?: string;
  /** Index of the ride (in planned order) this station is on or starts. */
  leg?: number;
}

export interface RideRow {
  type: 'ride';
  section: Section;
  leg: number;
  sectionIndex: number;
}

export type LineRow = StationRow | RideRow;

const roleOf = (w: Waypoint): StationRole =>
  w.kind === 'start' ? 'start' : w.kind === 'end' ? 'end' : w.kind === 'via' ? 'pass' : 'stop';

/** The route's stations, numbered by entry (rings carry none). */
function routeStations(tour: Pick<Tour, 'waypoints'>): StationRow[] {
  let entry = -1;
  return markRings(tour.waypoints).map((w): StationRow => {
    if (!w.ring) entry++;
    return {
      type: 'station',
      name: w.name,
      key: stopKey(w.stopRef),
      role: w.ring ? 'pass' : roleOf(w),
      ...(w.ring ? { ring: true, ...(w.templateId ? { line: w.templateId } : {}) } : { entry }),
      ...(w.kind === 'stop' || w.kind === 'turnaround' ? { stay: w.dwellMin } : {}),
    };
  });
}

/** The line before planning: just the route. */
export function routeRows(tour: Pick<Tour, 'waypoints'>): LineRow[] {
  return routeStations(tour);
}

/**
 * The line of a planned trip: each connection's rides, the stations where you board, change and
 * get off, and the route's stations passed on the way (with their times). Route stations the
 * timetable does not show are kept, without times, where they belong.
 */
export function plannedRows(tour: Pick<Tour, 'waypoints'>, connections: Connection[]): LineRow[] {
  const route = routeStations(tour);
  const wanted = new Set(route.map((r) => r.key));
  // The timetable's own sequence: boarding and alighting stations, and passed route stations.
  const seq: LineRow[] = [];
  const station = (
    name: string,
    ref: string,
    leg: number,
    times: Partial<Pick<StationRow, 'arr' | 'dep' | 'platformArr' | 'platformDep'>>,
  ) => {
    const key = stopKey(ref);
    const last = [...seq].reverse().find((r) => r.type === 'station') as StationRow | undefined;
    const lastIndex = seq.lastIndexOf(last as LineRow);
    // The same station again right away (arrive, then leave): one row.
    if (last && last.key === key && lastIndex === seq.length - 1) {
      Object.assign(last, Object.fromEntries(Object.entries(times).filter(([, v]) => v)));
      return;
    }
    seq.push({ type: 'station', name, key, role: 'change', leg, ...times });
  };
  connections.forEach((c, leg) => {
    c.sections.forEach((s, j) => {
      // A walk that stays at the station (another platform) is no step of its own.
      if (s.mode === 'walk' && stopKey(s.from.stopRef) === stopKey(s.to.stopRef)) return;
      station(s.from.name, s.from.stopRef, leg, { dep: s.from.dep, platformDep: s.from.platform });
      seq.push({ type: 'ride', section: s, leg, sectionIndex: j });
      for (const call of s.intermediate)
        if (wanted.has(stopKey(call.stopRef)))
          seq.push({
            type: 'station',
            name: call.name,
            key: stopKey(call.stopRef),
            role: 'pass',
            leg,
            ...(call.arr ? { arr: call.arr } : {}),
            ...(call.dep ? { dep: call.dep } : {}),
          });
      station(s.to.name, s.to.stopRef, leg, { arr: s.to.arr, platformArr: s.to.platform });
    });
  });

  // Match the route's stations in order; a timetable station that is none of them is a change.
  const out: LineRow[] = [];
  let p = 0;
  for (const row of seq) {
    if (row.type === 'ride') {
      out.push(row);
      continue;
    }
    // A station passed matches the next route station, or a later one of the same line (a
    // line's station the trains do not stop at); a station where the ride starts or ends may
    // match any station up to the next one where you get off.
    const boundary = row.role === 'change';
    let m = -1;
    for (let q = p; q < route.length; q++) {
      const r = route[q]!;
      if (r.key === row.key) {
        m = q;
        break;
      }
      const isBreak = r.role === 'stop' || r.role === 'end' || r.role === 'start';
      if (boundary ? isBreak : !r.ring) break;
    }
    if (m < 0) {
      out.push(row);
      continue;
    }
    // Stations you entered that the timetable skipped come first, without times; a line's
    // stations it skipped are left out.
    for (; p < m; p++) if (!route[p]!.ring) out.push(route[p]!);
    const r = route[m]!;
    out.push({
      ...row,
      name: r.name,
      role: r.role === 'pass' && row.role === 'change' ? 'change' : r.role,
      ...(r.entry !== undefined ? { entry: r.entry } : {}),
      ...(r.ring ? { ring: true } : {}),
      ...(r.line ? { line: r.line } : {}),
      ...(r.stay !== undefined ? { stay: r.stay } : {}),
    });
    p = m + 1;
  }
  for (; p < route.length; p++) out.push(route[p]!);
  return out;
}

/** How many entries the route has (the stations you can edit). */
export const entryCount = (tour: Pick<Tour, 'waypoints'>) => entriesOf(tour).length;
