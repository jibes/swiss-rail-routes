// Planner (SPEC §5): one OJP request per leg, filter by must-pass stops (and lines' modes),
// score, chain legs with a beam, relax constraints step by step when a leg has no survivor.
import type { GaData, RouteTemplate } from '../data';
import type { Connection, LatLon, Leg, Tour, Waypoint } from '../model';
import type { TripQuery } from '../ojp/request';
import { zurichDateTime } from '../ojp/request';
import { withLines } from '../line';
import { stopKey } from '../stops';
import { expandLegs } from '../tour';
import { isSupplement, warningsFor, type Warning } from '../warnings';
import { MIN, ms, rides, visited } from './connection';
import { passesVias, stitched, type Query } from './stitch';

export interface PlanDeps {
  fetchTrips: (q: TripQuery) => Promise<Connection[]>;
  templates: RouteTemplate[];
  ga: GaData;
  stop: (ref: string) => LatLon | undefined;
  /** Debug log (io/log.ts); the planner says what it asked, kept and gave up. */
  trace?: (event: string, data?: unknown) => void;
}

export interface Weights {
  transfer: number;
  afterSunset: number;
  disruption: number;
  tightTransfer: number;
}
/** Chains kept per leg, and the shortest change planned (minutes). */
const BEAM_WIDTH = 6;
const MIN_TRANSFER_MIN = 3;

export const DEFAULT_WEIGHTS: Weights = {
  transfer: 15,
  afterSunset: 60,
  disruption: 30,
  tightTransfer: 10,
};

/** The one rule that can be let go: a leg's must-pass stations (and its lines' modes). */
export type Relaxed = 'mustPass';

export interface LegRules {
  leg: Leg;
  mustPass: string[];
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

export function legRules(tour: Tour, deps: Pick<PlanDeps, 'templates'>): LegRules[] {
  // Routes saved before 0.8.1 tag both ends of a line: read as lines on their ends.
  return expandLegs({ ...tour, waypoints: withLines(tour.waypoints) }).map((leg) => {
    // The lines that run inside this leg: those leading to one of its stations after the
    // first (a line is marked on its end, its rings carry it too).
    const ids = new Set(
      [...leg.vias, leg.to].flatMap((w) =>
        w.ring && w.templateId ? [w.templateId] : w.line ? [w.line] : [],
      ),
    );
    const templates = deps.templates.filter((t) => ids.has(t.id));
    return {
      leg,
      mustPass: leg.vias.map((w) => stopKey(w.stopRef)),
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
        line: w.line ?? prev.line,
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
  if (!relaxed.has('mustPass')) {
    const at = visited(c);
    if (rules.mustPass.some((r) => !at.has(r))) return 'mustPass';
    // Each line in the leg ridden its way: Lake Lucerne by boat, not by the train beside it.
    const modes = new Set(rides(c).map(([s]) => s.mode));
    if (rules.templates.some((t) => !t.modes.some((m) => modes.has(m)))) return 'mustPass';
  }
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

/** A plan from one start time, with every chain found (arrive-by picks among them). */
type Planned = PlanResult & { chains: PlannedChain[] };

/** OJP answers by query: one plan's attempts (arrive-by asks again from earlier) share them. */
type Answers = Map<string, Connection[]>;

async function planFrom(
  start: number,
  input: Tour,
  deps: PlanDeps,
  cache: Answers = new Map(),
): Promise<Planned> {
  const tour = splitLoops(mergeRepeats(input));
  const wt = DEFAULT_WEIGHTS;
  const width = BEAM_WIDTH;
  const minTransfer = MIN_TRANSFER_MIN;
  const rulesList = legRules(tour, deps);
  const legs = rulesList.map((r) => r.leg);
  // Every stop the same one (a round trip with nothing in between): nothing to plan.
  if (!legs.length) return { relaxed: [], legs, chains: [] };
  const relaxedOut: PlanResult['relaxed'] = [];
  const trace = deps.trace ?? (() => undefined);
  const hm = (t: number) => zurichLocal(t).slice(11, 16);
  trace('plan.from', {
    start: zurichLocal(start),
    legs: legs.map(
      (l) => `${l.from.name} > ${l.vias.map((v) => v.name).join(', ')} > ${l.to.name}`,
    ),
  });

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
    if (!cache.has(key)) {
      const got = await deps.fetchTrips(q);
      trace('plan.query', {
        from: from.name,
        to: to.name,
        via: via.map((w) => w.name),
        at: hm(at),
        got: got.map((c) => `${hm(ms(c.dep))}-${hm(ms(c.arr))}/${c.transfers}`),
      });
      cache.set(key, got);
    }
    return cache.get(key)!;
  };

  /** One request with all vias; split at the vias when no answer passes them all. */
  const fetchAt = async (rules: LegRules, at: number, relaxed: Set<Relaxed>) => {
    const { from, to } = rules.leg;
    // Must-pass let go: asked without the vias, as OJP enforces the first one itself.
    const vias = relaxed.has('mustPass') ? [] : rules.leg.vias;
    const direct = await query(from, to, vias, at);
    if (vias.length < 2 || direct.some((c) => passesVias(c, vias))) return direct;
    const parts = await stitched(from, vias, to, at, query, minTransfer);
    trace('plan.stitched', {
      leg: `${from.name} > ${to.name}`,
      vias: vias.length,
      got: parts.length,
    });
    return parts.length ? parts : direct;
  };

  /**
   * A leg's rules without the stations no connection leads to from the one before (a line closed
   * that day), and without the lines' modes: the rest of what you chose still counts.
   */
  const reachableRules = async (rules: LegRules, at: number): Promise<LegRules> => {
    const vias: Waypoint[] = [];
    let here = rules.leg.from;
    for (const v of rules.leg.vias) {
      if (!(await query(here, v, [], at)).length) continue;
      vias.push(v);
      here = v;
    }
    trace('plan.reachable', { vias: vias.map((v) => v.name) });
    return {
      leg: { ...rules.leg, vias },
      mustPass: vias.map((w) => stopKey(w.stopRef)),
      templates: [],
    };
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
    // Every station and line; else the stations the timetable reaches at all (one closed line
    // does not cost the others); else whatever connects the leg's ends.
    const ladder = ['all', 'reachable', 'none'] as const;
    const next: Beam[] = [];
    for (const step of ladder) {
      const ready = Math.min(...beams.map((b) => b.ready));
      const asked = step === 'reachable' ? await reachableRules(rules, ready) : rules;
      if (step === 'reachable' && !asked.mustPass.length) continue;
      const relaxed = new Set<Relaxed>(step === 'none' ? ['mustPass'] : []);
      const all = await fetchAt(asked, ready, relaxed);
      let pool = all.filter((c) => !rejectReason(c, asked, relaxed));
      const why: Record<string, number> = {};
      for (const c of all) {
        const r = rejectReason(c, asked, relaxed);
        if (r) why[r] = (why[r] ?? 0) + 1;
      }
      trace('plan.leg', {
        leg: i,
        relaxed: step,
        from: hm(ready),
        answers: all.length,
        kept: pool.length,
        rejected: why,
        mustPass: asked.leg.vias.map((v) => v.name),
      });
      // Regular trains over panorama/supplement trains when both run.
      const regular = pool.filter((c) => !rides(c).some(([s]) => isSupplement(s, deps.ga)));
      if (regular.length) pool = regular;
      for (const b of beams) {
        let opts = pool.filter((c) => ms(c.dep) >= b.ready);
        if (!opts.length && b.ready > ready) {
          opts = (await fetchAt(asked, b.ready, relaxed)).filter(
            (c) => !rejectReason(c, asked, relaxed) && ms(c.dep) >= b.ready,
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
        // Said only when a kept connection really misses a station.
        if (step !== 'all' && next.some((b) => rejectReason(b.conns.at(-1)!, rules, new Set())))
          relaxedOut.push({ legIndex: i, rule: 'mustPass' });
        break;
      }
    }
    if (!next.length) {
      trace('plan.failed', { leg: i });
      return { relaxed: relaxedOut, failedLeg: i, legs, chains: [] };
    }
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
  const picked = pickOptions(done);
  trace('plan.result', {
    chains: done.length,
    options: picked.options?.map(
      (c) => `${hm(ms(c.dep))}-${hm(ms(c.arr))} score ${Math.round(c.score)}`,
    ),
    recommended: picked.recommended && hm(ms(picked.recommended.dep)),
    relaxed: relaxedOut,
    warnings: picked.recommended?.warnings.map((w) => w.type),
  });
  return { ...picked, relaxed: relaxedOut, legs, chains: done };
}

/**
 * Up to 3 options that leave at different times: the best-scored one, the earliest and the
 * latest other departure (each the best chain for its departure), sorted by departure.
 */
export function pickOptions(
  chains: PlannedChain[],
  /** Arrive by: of equally good ones, the one leaving last (not an hour early). */
  late = false,
): Pick<PlanResult, 'options' | 'recommended'> {
  if (!chains.length) return {};
  const perStart = new Map<string, PlannedChain>();
  const tie = (a: PlannedChain, b: PlannedChain) => (late ? ms(b.dep) - ms(a.dep) : 0);
  for (const c of [...chains].sort((a, b) => a.score - b.score || tie(a, b)))
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
  const result = ({ chains: _c, ...r }: Planned): PlanResult => r;
  if ('departAt' in tour.anchor)
    return result(
      await planFrom(ms(zurichDateTime(`${tour.date}T${tour.anchor.departAt}`)), tour, deps),
    );

  // Arrive by: start early enough for the stays and 90 min a leg, then, while nothing arrives
  // in time, earlier by as much as the earliest arrival was late (at least an hour).
  const by = ms(zurichDateTime(`${tour.date}T${tour.anchor.arriveBy}`));
  const legs = expandLegs(tour).length;
  const dwell = tour.waypoints.reduce((s, w) => s + w.dwellMin, 0);
  let start = by - (dwell + 90 * legs) * MIN;
  let last: Planned = { relaxed: [], chains: [] };
  const cache: Answers = new Map();
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await planFrom(start, tour, deps, cache);
    // Every chain found, not only the three picked: a later one may still arrive in time.
    const inTime = last.chains.filter((c) => ms(c.arr) <= by);
    deps.trace?.('plan.arriveBy', { attempt, inTime: inTime.length });
    if (inTime.length) return { ...result(last), ...pickOptions(inTime, true) };
    const earliest = Math.min(...last.chains.map((c) => ms(c.arr)));
    start -= Math.max(60 * MIN, Number.isFinite(earliest) ? earliest - by + 30 * MIN : 0);
  }
  return { ...result(last), options: undefined, recommended: undefined };
}
