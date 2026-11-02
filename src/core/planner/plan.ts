// Planner (SPEC §5): one OJP request per leg, filter by must-pass stops and avoided segments,
// score, chain legs with a beam, relax constraints when a leg has no survivor.
import type { GaData, RouteTemplate, Segment } from '../data';
import type { Connection, LatLon, Leg, Tour, Waypoint } from '../model';
import type { TripQuery } from '../ojp/request';
import { zurichDateTime } from '../ojp/request';
import { usesSegment } from '../segments';
import { stopKey } from '../stops';
import { expandLegs } from '../tour';
import { isSupplement, warningsFor, type Warning } from '../warnings';
import { MIN, ms, rides, stopSeq } from './connection';
import { calledAt, passesVias, ridden, stitched, type Query } from './stitch';

export interface PlanDeps {
  fetchTrips: (q: TripQuery) => Promise<Connection[]>;
  templates: RouteTemplate[];
  segments: Segment[];
  ga: GaData;
  stop: (ref: string) => LatLon | undefined;
  weights?: Partial<Weights>;
  minTransferMin?: number;
  beamWidth?: number;
}

export interface Weights {
  transfer: number;
  afterSunset: number;
  disruption: number;
  tightTransfer: number;
}
export const DEFAULT_WEIGHTS: Weights = {
  transfer: 15,
  afterSunset: 60,
  disruption: 30,
  tightTransfer: 10,
};

export type Relaxed = 'avoid' | 'mustPass';

export interface LegRules {
  leg: Leg;
  mustPass: string[];
  avoid: Segment[];
  templates: RouteTemplate[];
}

export interface PlannedChain {
  connections: Connection[];
  warnings: Warning[];
  score: number;
  dep: string;
  arr: string;
}

export interface PlanResult {
  /** Up to 3 chains that leave at different times, earliest first. */
  options?: PlannedChain[];
  /** The best-scored option (also in `options`). */
  recommended?: PlannedChain;
  relaxed: { legIndex: number; rule: Relaxed }[];
  /** First leg with no connection at all, even relaxed. */
  failedLeg?: number;
  /** The legs actually planned (after merging repeated stops and turning loops); index i of
   * every chain's connections belongs to legs[i]. Absent in plans saved before 2026-11-01. */
  legs?: Leg[];
}

export function legRules(tour: Tour, deps: Pick<PlanDeps, 'templates' | 'segments'>): LegRules[] {
  return expandLegs(tour).map((leg) => {
    const ids = new Set(
      [leg.from, ...leg.vias, leg.to].map((w) => w.templateId).filter((x): x is string => !!x),
    );
    const templates = deps.templates.filter((t) => ids.has(t.id));
    const avoidIds = new Set(templates.flatMap((t) => t.avoid));
    return {
      leg,
      mustPass: leg.vias.map((w) => stopKey(w.stopRef)),
      avoid: deps.segments.filter((s) => avoidIds.has(s.id)),
      templates,
    };
  });
}

/**
 * OJP cannot plan a leg that ends where it starts. Such a loop (a round trip without a stop)
 * turns at its middle via: that via becomes a stop of 0 min.
 */
/** Consecutive waypoints at the same stop are one: the later one's stop and dwell win. */
export function mergeRepeats(tour: Tour): Tour {
  const out: Waypoint[] = [];
  for (const w of tour.waypoints) {
    const prev = out.at(-1);
    if (prev && stopKey(prev.stopRef) === stopKey(w.stopRef)) {
      const keep = w.kind === 'via' ? prev : w;
      out[out.length - 1] = {
        ...keep,
        kind: out.length === 1 ? 'start' : keep.kind,
        dwellMin: Math.max(prev.dwellMin, w.dwellMin),
        templateId: w.templateId ?? prev.templateId,
      };
    } else out.push(w);
  }
  return out.length === tour.waypoints.length ? tour : { ...tour, waypoints: out };
}

export function splitLoops(tour: Tour): Tour {
  const turn = new Set<Waypoint>();
  for (const leg of expandLegs(tour))
    if (stopKey(leg.from.stopRef) === stopKey(leg.to.stopRef) && leg.vias.length)
      turn.add(leg.vias[Math.floor((leg.vias.length - 1) / 2)]!);
  if (!turn.size) return tour;
  return {
    ...tour,
    waypoints: tour.waypoints.map((w) => (turn.has(w) ? { ...w, kind: 'stop', dwellMin: 0 } : w)),
  };
}

/** Why a connection fails the leg's rules, or null when it passes. */
export function rejectReason(
  c: Connection,
  rules: LegRules,
  relaxed: Set<Relaxed>,
): Relaxed | null {
  const seq = stopSeq(c);
  if (!relaxed.has('mustPass')) {
    const have = new Set(seq);
    const at = ridden(c);
    const passed = (r: string) => {
      if (have.has(r)) return true;
      const w = rules.leg.vias.find((v) => stopKey(v.stopRef) === r);
      return !!w && calledAt(w, at);
    };
    if (rules.mustPass.some((r) => !passed(r))) return 'mustPass';
  }
  if (!relaxed.has('avoid') && rules.avoid.some((s) => usesSegment(seq, s))) return 'avoid';
  return null;
}

function scoreOf(c: Connection, w: Warning[], wt: Weights): number {
  const count = (t: Warning['type']) => w.filter((x) => x.type === t).length;
  return (
    wt.transfer * c.transfers +
    wt.afterSunset * count('after-sunset') +
    wt.disruption * count('disruption') +
    wt.tightTransfer * count('tight-transfer')
  );
}

/** ms → `YYYY-MM-DDTHH:MM` in Swiss local time. */
export function zurichLocal(t: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

interface Beam {
  conns: Connection[];
  warnings: Warning[];
  penalty: number;
  ready: number;
}

const firstDep = (b: Beam) => ms(b.conns[0]!.dep);
const lastArr = (b: Beam) => ms(b.conns.at(-1)!.arr);
const total = (b: Beam) => (lastArr(b) - firstDep(b)) / MIN + b.penalty;

async function planFrom(start: number, input: Tour, deps: PlanDeps): Promise<PlanResult> {
  const tour = splitLoops(mergeRepeats(input));
  const wt = { ...DEFAULT_WEIGHTS, ...deps.weights };
  const width = deps.beamWidth ?? 6;
  const minTransfer = deps.minTransferMin ?? 3;
  const rulesList = legRules(tour, deps);
  const legs = rulesList.map((r) => r.leg);
  const relaxedOut: PlanResult['relaxed'] = [];
  const cache = new Map<string, Connection[]>();

  const query: Query = async (from, to, via, at) => {
    // OJP refuses a trip from a stop to itself (TRIP_ORIGINDESTINATIONIDENTICAL).
    if (stopKey(from.stopRef) === stopKey(to.stopRef)) return [];
    const q: TripQuery = {
      origin: { ref: from.stopRef, name: from.name },
      destination: { ref: to.stopRef, name: to.name },
      vias: via.map((w) => ({ ref: w.stopRef, name: w.name })),
      notVias: [],
      time: zurichLocal(at),
      arriveBy: false,
      results: 6,
    };
    const key = JSON.stringify(q);
    if (!cache.has(key)) cache.set(key, await deps.fetchTrips(q));
    return cache.get(key)!;
  };

  /** One request with all vias; split at the vias when no answer passes them all. */
  const fetchAt = async (rules: LegRules, at: number) => {
    const { from, vias, to } = rules.leg;
    const direct = await query(from, to, vias, at);
    if (vias.length < 2 || direct.some((c) => passesVias(c, vias))) return direct;
    const parts = await stitched(from, vias, to, at, query, minTransfer);
    return parts.length ? parts : direct;
  };

  let beams: Beam[] = [{ conns: [], warnings: [], penalty: 0, ready: start }];
  for (const [i, rules] of rulesList.entries()) {
    const ctx = {
      legIndex: i,
      date: tour.date,
      ticket: tour.ticket,
      templates: rules.templates,
      ga: deps.ga,
      stop: deps.stop,
    };
    const ladder: Relaxed[][] = [[], ['avoid'], ['avoid', 'mustPass']];
    const next: Beam[] = [];
    for (const step of ladder) {
      const relaxed = new Set(step);
      const ready = Math.min(...beams.map((b) => b.ready));
      let pool = (await fetchAt(rules, ready)).filter((c) => !rejectReason(c, rules, relaxed));
      // Regular trains over panorama/supplement trains when both run.
      const regular = pool.filter((c) => !rides(c).some(([s]) => isSupplement(s, deps.ga)));
      if (regular.length) pool = regular;
      for (const b of beams) {
        let opts = pool.filter((c) => ms(c.dep) >= b.ready);
        if (!opts.length && b.ready > ready) {
          opts = (await fetchAt(rules, b.ready)).filter(
            (c) => !rejectReason(c, rules, relaxed) && ms(c.dep) >= b.ready,
          );
        }
        for (const c of opts) {
          const w = warningsFor(c, ctx);
          const dwell = Math.max(rules.leg.to.dwellMin, minTransfer);
          next.push({
            conns: [...b.conns, c],
            warnings: [...b.warnings, ...w],
            penalty: b.penalty + scoreOf(c, w, wt),
            ready: ms(c.arr) + dwell * MIN,
          });
        }
      }
      if (next.length) {
        // Report only the rules the kept connections actually break.
        const broken = new Set<Relaxed>();
        for (const b of next) {
          const r = rejectReason(b.conns.at(-1)!, rules, new Set());
          if (r) broken.add(r);
          if (r === 'avoid' && rejectReason(b.conns.at(-1)!, rules, new Set(['avoid'])))
            broken.add('mustPass');
        }
        for (const r of step) if (broken.has(r)) relaxedOut.push({ legIndex: i, rule: r });
        break;
      }
    }
    if (!next.length) return { relaxed: relaxedOut, failedLeg: i, legs };
    // Keep the best chain per first departure, so options can differ; then the best overall.
    next.sort((a, b) => total(a) - total(b));
    const perStart = new Map<number, Beam>();
    for (const b of next) if (!perStart.has(firstDep(b))) perStart.set(firstDep(b), b);
    const keep = new Set([...perStart.values()].slice(0, width));
    for (const b of next) if (keep.size < width) keep.add(b);
    keep.add(next.reduce((a, b) => (firstDep(b) < firstDep(a) ? b : a)));
    keep.add(next.reduce((a, b) => (firstDep(b) > firstDep(a) ? b : a)));
    beams = [...keep];
  }

  const done = beams.map((b): PlannedChain => ({
    connections: b.conns,
    warnings: b.warnings,
    score: total(b),
    dep: b.conns[0]!.dep,
    arr: b.conns.at(-1)!.arr,
  }));
  return { ...pickOptions(done), relaxed: relaxedOut, legs };
}

/**
 * Up to 3 options that leave at different times: the best-scored one, the earliest and the
 * latest other departure (each the best chain for its departure), sorted by departure.
 */
export function pickOptions(chains: PlannedChain[]): Pick<PlanResult, 'options' | 'recommended'> {
  if (!chains.length) return {};
  const perStart = new Map<string, PlannedChain>();
  for (const c of [...chains].sort((a, b) => a.score - b.score))
    if (!perStart.has(c.dep)) perStart.set(c.dep, c);
  const distinct = [...perStart.values()];
  const recommended = distinct[0]!;
  const others = distinct.slice(1).sort((a, b) => ms(a.dep) - ms(b.dep));
  const picked = new Set(
    [recommended, others[0], others.at(-1)].filter((c): c is PlannedChain => !!c),
  );
  return {
    recommended,
    options: [...picked].sort((a, b) => ms(a.dep) - ms(b.dep)),
  };
}

/**
 * Plans a tour. Depart-at plans forward from the anchor. Arrive-by starts early enough for the
 * dwell plus 90 min a leg, keeps chains back in time, and moves an hour earlier up to 3 times.
 */
export async function plan(tour: Tour, deps: PlanDeps): Promise<PlanResult> {
  if (tour.waypoints.length < 2) return { relaxed: [] };
  if ('departAt' in tour.anchor)
    return planFrom(ms(zurichDateTime(`${tour.date}T${tour.anchor.departAt}`)), tour, deps);

  const by = ms(zurichDateTime(`${tour.date}T${tour.anchor.arriveBy}`));
  const legs = expandLegs(tour).length;
  const dwell = tour.waypoints.reduce((s, w) => s + w.dwellMin, 0);
  let start = by - (dwell + 90 * legs) * MIN;
  let last: PlanResult = { relaxed: [] };
  for (let attempt = 0; attempt < 4; attempt++, start -= 60 * MIN) {
    last = await planFrom(start, tour, deps);
    const inTime = (last.options ?? []).filter((c) => ms(c.arr) <= by);
    if (inTime.length) return { ...last, ...pickOptions(inTime) };
  }
  return { ...last, options: undefined, recommended: undefined };
}
