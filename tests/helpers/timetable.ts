// Hand-built connections for planner tests. Not OJP output: the parser has its own fixtures.
import { readFileSync } from 'node:fs';
import type { GaData, RouteTemplate, Segment } from '../../src/core/data';
import type { Connection, Section } from '../../src/core/model';
import type { TripQuery } from '../../src/core/ojp/request';
import { zurichDateTime } from '../../src/core/ojp/request';
import { createStopSearch, stopKey, type StopIndexFile } from '../../src/core/stops';
import gaJson from '../../src/data/ga.json';
import segmentsJson from '../../src/data/segments.json';
import templatesJson from '../../src/data/templates.json';

export const index = createStopSearch(
  JSON.parse(readFileSync('public/data/stops.v1.json', 'utf8')) as StopIndexFile,
);
export const templates = templatesJson.templates as RouteTemplate[];
export const segments = segmentsJson.segments as Segment[];
export const ga = gaJson as GaData;

export const ref = (name: string) => {
  const s = index.search(name, 1)[0];
  if (s?.name !== name) throw new Error(`no stop ${name}`);
  return s.ref;
};

export const DATE = '2026-11-07';
const at = (hhmm: string) => zurichDateTime(`${DATE}T${hhmm}`);

/** One ride: "IR 46" from stop/time list like [['Zürich HB','08:09'], ['Zug','08:30'], …]. */
export function ride(
  line: string,
  calls: [string, string][],
  extra: Partial<Section> = {},
): Section {
  const [category, number] = line.split(' ');
  const pts = calls.map(([name, t]) => ({ stopRef: ref(name), name, dep: at(t), arr: at(t) }));
  return {
    mode: 'rail',
    category,
    number,
    from: { ...pts[0]!, arr: undefined },
    to: { ...pts.at(-1)!, dep: undefined },
    intermediate: pts.slice(1, -1),
    ...extra,
  };
}

export function conn(...sections: Section[]): Connection {
  const r = sections.filter((s) => s.mode !== 'walk');
  return {
    legIndex: 0,
    dep: r[0]!.from.dep!,
    arr: r.at(-1)!.to.arr!,
    transfers: r.length - 1,
    sections,
  };
}

/** Fake OJP: connections by origin→destination, departing at or after the query time. */
export function timetable(list: Connection[]) {
  const calls: TripQuery[] = [];
  const fetchTrips = async (q: TripQuery) => {
    calls.push(q);
    const t = Date.parse(zurichDateTime(q.time));
    return list
      .filter(
        (c) =>
          stopKey(c.sections[0]!.from.stopRef) === stopKey(q.origin.ref) &&
          stopKey(c.sections.at(-1)!.to.stopRef) === stopKey(q.destination.ref) &&
          Date.parse(c.dep) >= t,
      )
      .sort((a, b) => Date.parse(a.dep) - Date.parse(b.dep))
      .slice(0, q.results);
  };
  return { fetchTrips, calls };
}

export const deps = (list: Connection[]) => {
  const tt = timetable(list);
  return {
    tt,
    deps: {
      fetchTrips: tt.fetchTrips,
      templates,
      segments,
      ga,
      stop: (r: string) => index.byRef(r),
    },
  };
};
