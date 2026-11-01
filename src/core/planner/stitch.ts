// The Swiss OJP service enforces only the first <Via> of a TripRequest (checked live 2026-11-01:
// [Wattwil] alone 6/6, [Biberbrugg, Wattwil] never through Wattwil). A leg with more vias is
// first asked as is; when no answer passes every via, it is split into sub-queries of one via
// plus the next via as destination, and the answers are stitched, merging the two halves of a
// ride that continues through the split point.
import type { Connection, Section, Waypoint } from '../model';
import { stopKey } from '../stops';
import { MIN, ms, rides } from './connection';

export type Query = (
  from: Waypoint,
  to: Waypoint,
  via: Waypoint[],
  at: number,
) => Promise<Connection[]>;

const RESULTS = 6;

/** Points of the sub-queries: [from, v1 as via, v2], [v2, v3 as via, v4], … */
export function subLegs(from: Waypoint, vias: Waypoint[], to: Waypoint) {
  const pts = [from, ...vias, to];
  const out: { from: Waypoint; via: Waypoint[]; to: Waypoint }[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    if (i + 2 < pts.length) {
      out.push({ from: pts[i]!, via: [pts[i + 1]!], to: pts[i + 2]! });
      i += 2;
    } else {
      out.push({ from: pts[i]!, via: [], to: pts[i + 1]! });
      i += 1;
    }
  }
  return out;
}

function merge(a: Section, b: Section): Section {
  const through = { ...a.to, dep: b.from.dep };
  return {
    ...a,
    to: b.to,
    intermediate: [...a.intermediate, through, ...b.intermediate],
    geometry: a.geometry && b.geometry ? [...a.geometry, ...b.geometry] : undefined,
    situationIds: [...new Set([...(a.situationIds ?? []), ...(b.situationIds ?? [])])],
    notices: [...new Set([...(a.notices ?? []), ...(b.notices ?? [])])],
  };
}

/** Joins two connections end to start; one ride when the same vehicle runs on. */
export function join(a: Connection, b: Connection): Connection {
  const last = rides(a).at(-1)?.[0];
  const first = rides(b)[0]?.[0];
  let sections: Section[];
  if (last && first && last.journey && last.journey === first.journey) {
    const ai = a.sections.lastIndexOf(last);
    const bi = b.sections.indexOf(first);
    sections = [...a.sections.slice(0, ai), merge(last, first), ...b.sections.slice(bi + 1)];
  } else sections = [...a.sections, ...b.sections];
  const n = sections.filter((s) => s.mode !== 'walk').length;
  return { legIndex: a.legIndex, dep: a.dep, arr: b.arr, transfers: Math.max(0, n - 1), sections };
}

const sameVehicle = (a: Connection, b: Connection) => {
  const x = rides(a).at(-1)?.[0].journey;
  return !!x && x === rides(b)[0]?.[0].journey;
};

const signature = (c: Connection) =>
  `${c.dep}|${c.arr}|${c.sections.map((s) => s.journey ?? s.mode).join()}`;

/** Unique chains, at most RESULTS: the earliest arrival per departure first, then the rest. */
function diverse(list: Connection[]): Connection[] {
  const seen = new Set<string>();
  const unique = list
    .sort((a, b) => ms(a.dep) - ms(b.dep) || ms(a.arr) - ms(b.arr))
    .filter((c) => !seen.has(signature(c)) && !!seen.add(signature(c)));
  const firstPerDep = unique.filter((c, i) => i === 0 || unique[i - 1]!.dep !== c.dep);
  const rest = unique.filter((c) => !firstPerDep.includes(c));
  return [...firstPerDep, ...rest].slice(0, RESULTS).sort((a, b) => ms(a.dep) - ms(b.dep));
}

/** Stitched candidates for a leg, earliest first; at most RESULTS. */
export async function stitched(
  from: Waypoint,
  vias: Waypoint[],
  to: Waypoint,
  at: number,
  query: Query,
  minTransferMin: number,
): Promise<Connection[]> {
  const parts = subLegs(from, vias, to);
  let partial = (await query(parts[0]!.from, parts[0]!.to, parts[0]!.via, at)).slice(0, RESULTS);
  for (const p of parts.slice(1)) {
    if (!partial.length) return [];
    const earliest = Math.min(...partial.map((c) => ms(c.arr)));
    const pool = await query(p.from, p.to, p.via, earliest);
    const next: Connection[] = [];
    for (const c of partial) {
      const ready = (x: Connection) => ms(c.arr) + (sameVehicle(c, x) ? 0 : minTransferMin * MIN);
      let picks = pool.filter((x) => ms(x.dep) >= ready(x));
      if (!picks.length)
        picks = (await query(p.from, p.to, p.via, ms(c.arr))).filter((x) => ms(x.dep) >= ready(x));
      // The first onward ride, and the next one: different starts keep different chains.
      for (const x of picks.slice(0, 2)) next.push(join(c, x));
    }
    partial = diverse(next);
  }
  return partial;
}

/** True when a connection calls at every via, in any order. */
export const passesVias = (c: Connection, vias: Waypoint[]) => {
  const keys = new Set(
    c.sections.flatMap((s) =>
      (s.mode === 'walk' ? [] : [s.from, ...s.intermediate, s.to]).map((x) => stopKey(x.stopRef)),
    ),
  );
  return vias.every((v) => keys.has(stopKey(v.stopRef)));
};
