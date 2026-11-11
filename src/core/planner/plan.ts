// Planner (SPEC §5): one OJP request per leg, filter by must-pass stops (and lines' modes),
// score, chain legs with a beam, relax constraints step by step when a leg has no survivor.
import type { GaData, RouteTemplate } from '../data';
import type { Connection, LatLon, Leg, Tour, Waypoint } from '../model';
import type { TripQuery } from '../ojp/request';
import { zurichDateTime } from '../ojp/request';
import { withLines } from '../line';
import { stopKey } from '../stops';
import { expandLegs } from '../tour';
import { isSupplement, markByRoad, warningsFor, type Warning } from '../warnings';
import {
  expectedArr,
  expectedDep,
  isTight,
  runsOn,
  MIN,
  ms,
  rides,
  visited,
  walkMinutes,
} from './connection';
import { passesVias, stitched, type Query } from './stitch';

/**
 * Trains that need a reservation or supplement. Avoid: only when no regular train runs, or none
 * arrives in time. Include: like any other. Never: not even when that leaves no connection.
 */
export type Reservations = 'avoid' | 'include' | 'never';

export interface PlanDeps {
  fetchTrips: (q: TripQuery) => Promise<Connection[]>;
  templates: RouteTemplate[];
  ga: GaData;
  stop: (ref: string) => LatLon | undefined;
  /** A place by the name a notice gives it (`placeByName`): reads a disruption against the track. */
  place?: (name: string) => LatLon | undefined;
  /** Absent: avoid. */
  reservations?: Reservations;
  /** Debug log (io/log.ts); the planner says what it asked, kept and gave up. */
  trace?: (event: string, data?: unknown) => void;
}

export interface Weights {
  transfer: number;
  afterSunset: number;
  /** A scenic line's stretch ridden in the dark: of otherwise equal options, the one by day. */
  lineAfterDark: number;
  disruption: number;
  tightTransfer: number;
  /** A scenic line asked for and not ridden: well behind any plan that rides it. */
  lineMissed: number;
  /** A stop left later than you asked (`leaveBy`): only when no connection leaves in time. */
  windowMissed: number;
}
/** Chains kept per leg, and the shortest change planned (minutes). */
const BEAM_WIDTH = 6;
const MIN_TRANSFER_MIN = 3;
/** Arrive by: a trip's day starts here; leaving before it is only for when nothing else arrives. */
const DAY_START = '05:00';

export const DEFAULT_WEIGHTS: Weights = {
  transfer: 15,
  afterSunset: 60,
  lineAfterDark: 20,
  disruption: 30,
  tightTransfer: 10,
  lineMissed: 120,
  windowMissed: 120,
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
  /** The choice it was planned under, said by the app (io/planTrip.ts). Absent: avoid. */
  reservations?: Reservations;
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
        ...((w.stayUntil ?? prev.stayUntil) ? { stayUntil: w.stayUntil ?? prev.stayUntil } : {}),
      };
    } else out.push(w);
  }
  return out.length === tour.waypoints.length ? tour : { ...tour, waypoints: out };
}

/**
 * OJP cannot plan a leg that ends where it starts. Such a loop (a round trip without a stop)
 * turns at a via, which becomes a stop of 0 min.
 */
export function splitLoops(tour: Tour): Tour {
  const turn = new Set<Waypoint>();
  // A line's rings are its stations, not yours: the turn is one of yours (the middle one when
  // several), the middle ring only when you entered none.
  const lined = withLines(tour.waypoints);
  const ring = new Set(tour.waypoints.filter((_, i) => lined[i]?.ring));
  for (const leg of expandLegs(tour))
    if (stopKey(leg.from.stopRef) === stopKey(leg.to.stopRef) && leg.vias.length) {
      const own = leg.vias.filter((w) => !ring.has(w));
      const among = own.length ? own : leg.vias;
      turn.add(among[Math.floor((among.length - 1) / 2)]!);
    }
  if (!turn.size) return tour;
  return {
    ...tour,
    waypoints: tour.waypoints.map((w) => (turn.has(w) ? { ...w, kind: 'stop', dwellMin: 0 } : w)),
  };
}

/**
 * The change from one leg's last ride to the next leg's first, judged as `warningsFor` judges
 * a change within a connection and as the live view will: tight below TIGHT_TRANSFER_MIN or
 * the walk between them. Said on the ride you leave. A stay planned there is time enough.
 */
function changeWarning(prev: Connection | undefined, c: Connection, legIndex: number): Warning[] {
  const a = rides(prev ?? c).at(-1);
  const b = rides(c)[0];
  if (!prev || !a || !b || !a[0].to.arr || !b[0].from.dep) return [];
  if (runsOn(a[0], b[0])) return [];
  const walk = [...prev.sections.slice(a[1] + 1), ...c.sections.slice(0, b[1])].reduce(
    (m, s) => m + (s.mode === 'walk' ? walkMinutes(s) : 0),
    0,
  );
  const min = (ms(b[0].from.dep) - ms(a[0].to.arr)) / MIN;
  if (!isTight(min, walk)) return [];
  return [
    {
      type: 'tight-transfer',
      severity: 'warn',
      legIndex: legIndex - 1,
      sectionIndex: a[1],
      key: 'wTightTransfer',
      params: { min: Math.max(0, Math.round(min)), at: a[0].to.name },
    },
  ];
}

/** A next connection this much later on the leg is said (a sparse line, the last one back). */
export const GAP_MIN = 120;

/**
 * How long after `c` the next connection of the same answers leaves, said when over `GAP_MIN`
 * (on its first ride). Nothing when the answers hold none later: never guessed.
 */
export function gapWarning(c: Connection, others: Connection[], legIndex: number): Warning[] {
  const dep = ms(expectedDep(c));
  const later = others.map((o) => ms(expectedDep(o))).filter((t) => t > dep);
  if (!later.length) return [];
  const next = Math.min(...later);
  const gap = Math.round((next - dep) / MIN);
  if (gap <= GAP_MIN) return [];
  const first = rides(c)[0];
  const h = Math.floor(gap / 60);
  const m = gap % 60;
  return [
    {
      type: 'sparse',
      severity: 'info',
      legIndex,
      ...(first ? { sectionIndex: first[1] } : {}),
      key: 'wSparse',
      params: { gap: m ? `${h} h ${m} min` : `${h} h`, at: zurichLocal(next).slice(11, 16) },
    },
  ];
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
    wt.lineAfterDark * count('line-after-dark') +
    // A notice weighs by its grade (0.21.2): a timetable shift is no closure.
    wt.disruption *
      w
        .filter((x) => x.type === 'disruption' || x.type === 'notice')
        .reduce((n, x) => n + (x.severity === 'error' ? 1 : x.severity === 'warn' ? 0.5 : 0.1), 0) +
    wt.tightTransfer * count('tight-transfer') +
    wt.lineMissed * count('line-missed') +
    wt.windowMissed * count('window-missed')
  );
}

/**
 * The scenic lines a leg asks for that a connection does not ride (reported 5 Nov 2026: the
 * Albula, closed, planned via the Vereina with not a word): an error naming the line and its
 * stations not reached, or, all reached, that it is not ridden its way (by the train beside the
 * lake). Only for a connection the planner had to let the leg's stations go for.
 */
export function lineMissed(c: Connection, rules: LegRules, legIndex: number): Warning[] {
  if (!rules.templates.length) return [];
  const at = visited(c);
  const modes = new Set(rides(c).map(([s]) => s.mode));
  return rules.templates.flatMap((t): Warning[] => {
    const own = new Set(t.chain.map((x) => stopKey(x.ref)));
    const missed = rules.leg.vias.filter(
      (w) => own.has(stopKey(w.stopRef)) && !at.has(stopKey(w.stopRef)),
    );
    const base = { type: 'line-missed' as const, severity: 'error' as const, legIndex };
    if (missed.length)
      return [
        {
          ...base,
          key: 'wLineMissed',
          params: { line: t.name, stations: missed.map((w) => w.name).join(', ') },
        },
      ];
    if (!t.modes.some((m) => modes.has(m)))
      return [{ ...base, key: 'wLineNotRidden', params: { line: t.name } }];
    return [];
  });
}

/** A day trip is back the next day when its last arrival is a later day, from this hour on. */
const NIGHT_ENDS = '03:00';

/**
 * Reported 5 Nov 2026: a day trip offered with its way back at 04:23 the next morning. A chain
 * back on a later day than it left, past `NIGHT_ENDS`, is dropped while another is back the same
 * day; when none is, kept and said ("back the next day at 06:55"). Routes whose stays fill the
 * night themselves are left alone.
 */
export function sameDayFirst(chains: PlannedChain[], tour: Tour): PlannedChain[] {
  const stays = tour.waypoints.reduce((m, w) => m + w.dwellMin, 0);
  // Over several days by design (a stay until a later day): no day trip to keep to one day. A
  // stay until a time the same day (0.51.0, the panel's "until") is a day trip still.
  const later = (w: Tour['waypoints'][number]) =>
    !!w.stayUntil && w.stayUntil.slice(0, 10) > (tour.date ?? '');
  if (stays >= 12 * 60 || tour.waypoints.some(later)) return chains;
  const nextDay = (c: PlannedChain) => {
    const dep = zurichLocal(ms(c.dep)).slice(0, 10);
    const arr = zurichLocal(ms(c.arr));
    return arr.slice(0, 10) > dep && arr.slice(11, 16) >= NIGHT_ENDS;
  };
  const sameDay = chains.filter((c) => !nextDay(c));
  if (sameDay.length) return sameDay;
  return chains.map((c) => ({
    ...c,
    warnings: [
      ...c.warnings,
      {
        type: 'next-day',
        severity: 'warn',
        legIndex: c.connections.length - 1,
        key: 'wNextDay',
        params: { time: zurichLocal(ms(c.arr)).slice(11, 16) },
      },
    ],
  }));
}

/**
 * Retest round 3, 6 Nov 2026: options that leave a stay later than asked (`leaveBy`) were listed
 * beside one that leaves in time. Once any leaves in time, those that cannot go; when none can,
 * all stay, each said (`window-missed`).
 */
export function inTime(chains: PlannedChain[]): PlannedChain[] {
  const ok = chains.filter((c) => !c.warnings.some((w) => w.type === 'window-missed'));
  return ok.length ? ok : chains;
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

/** A stop's time on the trip's day (`leaveBy`, `arriveAfter`), as ms; undefined when unset. */
const timeOn = (date: string, hhmm: string | undefined) =>
  hhmm ? ms(zurichDateTime(`${date}T${hhmm}`)) : undefined;

/**
 * Connections that leave `from` by its `leaveBy` (reported on the MCP, 5 Nov 2026: a stay at
 * Melide ran past Swissminiatur's closing). None in time: all of them, each said as leaving late
 * (`window-missed`, scored well behind one in time).
 */
export function leavingBy(
  opts: Connection[],
  from: Waypoint,
  date: string,
  legIndex: number,
): { opts: Connection[]; late: (c: Connection) => Warning[] } {
  const by = timeOn(date, from.leaveBy);
  if (by === undefined) return { opts, late: () => [] };
  const inTime = opts.filter((c) => ms(expectedDep(c)) <= by);
  if (inTime.length) return { opts: inTime, late: () => [] };
  return {
    opts,
    late: (c) => [
      {
        type: 'window-missed',
        severity: 'error',
        legIndex,
        ...(rides(c)[0] ? { sectionIndex: rides(c)[0]![1] } : {}),
        key: 'wWindowMissed',
        params: {
          at: from.name,
          time: from.leaveBy!,
          dep: zurichLocal(ms(expectedDep(c))).slice(11, 16),
        },
      },
    ],
  };
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
  reservations: Reservations = deps.reservations ?? 'avoid',
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
    // A leg with many vias can be too much for OJP in one go (504 after 25 s, log of 6 Nov 2026:
    // Zürich > St. Moritz, Gstaad, Montreux > Erstfeld): asked at its vias instead, as when no
    // answer passes them all. A request stopped by the person (an edit) stops the plan.
    let direct: Connection[];
    try {
      direct = await query(from, to, vias, at);
    } catch (e) {
      if (vias.length < 2 || (e instanceof Error && e.name === 'AbortError')) throw e;
      trace('plan.split', { leg: `${from.name} > ${to.name}`, vias: vias.length, e });
      const parts = await stitched(from, vias, to, at, query, minTransfer);
      if (!parts.length) throw e;
      return parts;
    }
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
      place: deps.place,
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
      // A replacement bus standing in for the leg's line passes its stations by road.
      const byRoad = (list: Connection[]) =>
        markByRoad(list, { templates: rules.templates, stop: deps.stop });
      const all = byRoad(await fetchAt(asked, ready, relaxed));
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
      // Regular trains over panorama/supplement trains when both run: in the shared pool, and
      // just the same in an answer fetched for one beam alone.
      const isRegular = (c: Connection) => !rides(c).some(([s]) => isSupplement(s, deps.ga));
      const preferred = (list: Connection[]) => {
        const regular = list.filter(isRegular);
        return reservations === 'never' || (reservations === 'avoid' && regular.length)
          ? regular
          : list;
      };
      pool = preferred(pool);
      // Chained by the times expected (a delay the service knew as it answered), so a change
      // that is already lost is never planned; the warnings read the timetable, as the line does.
      for (const b of beams) {
        let opts = pool.filter((c) => ms(expectedDep(c)) >= b.ready);
        if (!opts.length && b.ready > ready) {
          const own = byRoad(await fetchAt(asked, b.ready, relaxed)).filter(
            (c) => !rejectReason(c, asked, relaxed) && ms(expectedDep(c)) >= b.ready,
          );
          opts = preferred(own);
        }
        const fit = leavingBy(opts, rules.leg.from, tour.date, i);
        for (const c of fit.opts) {
          const w = [
            ...fit.late(c),
            ...warningsFor(c, ctx),
            ...changeWarning(b.conns.at(-1), c, i),
            ...gapWarning(c, fit.opts, i),
            ...(step === 'all' ? [] : lineMissed(c, rules, i)),
          ];
          const dwell = Math.max(rules.leg.to.dwellMin, minTransfer);
          next.push({
            conns: [...b.conns, c],
            warnings: [...b.warnings, ...w],
            penalty: b.penalty + scoreOf(c, w, wt),
            // A place that opens later: the stay starts when it does.
            // A stay until a date and time: no earlier, on whatever day (multi-day trips).
            ready: Math.max(
              Math.max(ms(expectedArr(c)), timeOn(tour.date, rules.leg.to.arriveAfter) ?? 0) +
                dwell * MIN,
              rules.leg.to.stayUntil ? ms(zurichDateTime(rules.leg.to.stayUntil)) : 0,
            ),
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

  // Waiting after the time asked for costs as travel does (round 3, 6 Nov 2026: Nyon–La Cure
  // from 09:00 recommended the 13:29 for being a minute shorter than the 09:29).
  const done = sameDayFirst(
    beams.map((b): PlannedChain => ({
      connections: b.conns,
      warnings: b.warnings,
      score: total(b) + Math.max(0, firstDep(b) - start) / MIN,
      dep: b.conns[0]!.dep,
      arr: b.conns.at(-1)!.arr,
    })),
    tour,
  );
  const picked = pickOptions(inTime(done));
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
 * dwell plus 90 min a leg, keeps chains back in time, and moves earlier while none is: to the
 * start of the trip's day, and into the night before only when that day has nothing in time.
 */
export async function plan(tour: Tour, deps: PlanDeps): Promise<PlanResult> {
  if (tour.waypoints.length < 2) return { relaxed: [] };
  const result = ({ chains: _c, ...r }: Planned): PlanResult => r;
  if ('departAt' in tour.anchor)
    return result(
      await planFrom(ms(zurichDateTime(`${tour.date}T${tour.anchor.departAt}`)), tour, deps),
    );

  // Arrive by: start early enough for the stays and 90 min a leg, then, while nothing arrives
  // in time, earlier by as much as the earliest arrival was late (at least an hour). A miss can
  // be a whole night (the way back runs next morning), so the day's start is always tried.
  // Over several days (a stay until a later day): arriving by that time on the last day, and
  // leaving on the trip's own from its start (reported in review: nothing was ever in time).
  const lastDay = tour.waypoints.reduce(
    (d, w) => (w.stayUntil && w.stayUntil.slice(0, 10) > d ? w.stayUntil.slice(0, 10) : d),
    tour.date,
  );
  const by = ms(zurichDateTime(`${lastDay}T${tour.anchor.arriveBy}`));
  const dayStart = ms(zurichDateTime(`${tour.date}T${DAY_START}`));
  const legs = expandLegs(splitLoops(mergeRepeats(tour))).length;
  const dwell = tour.waypoints.reduce((s, w) => s + w.dwellMin, 0);
  // Not before the day's start while that is an option (an arrival before it has none).
  const inDayFrom = (was: number, t: number) => (was > dayStart ? Math.max(t, dayStart) : t);
  let start = lastDay > tour.date ? dayStart : inDayFrom(by, by - (dwell + 90 * legs) * MIN);
  let last: Planned = { relaxed: [], chains: [] };
  const cache: Answers = new Map();
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await planFrom(start, tour, deps, cache);
    // Every chain found, not only the three picked: a later one may still arrive in time.
    let inTime = last.chains.filter((c) => ms(c.arr) <= by);
    // Regular trains are too late: one that needs a reservation beats leaving in the night.
    if (!inTime.length && start === dayStart && (deps.reservations ?? 'avoid') === 'avoid') {
      last = await planFrom(start, tour, deps, cache, 'include');
      inTime = last.chains.filter((c) => ms(c.arr) <= by);
    }
    deps.trace?.('plan.arriveBy', { attempt, inTime: inTime.length });
    if (inTime.length) {
      // Arrive by: arriving earlier than asked is waiting too, not the wait before leaving.
      const from = start;
      const byScore = inTime.map((c) => ({
        ...c,
        score: c.score - Math.max(0, ms(c.dep) - from) / MIN + (by - ms(c.arr)) / MIN,
      }));
      const inDay = byScore.filter((c) => ms(c.dep) >= dayStart);
      return { ...result(last), ...pickOptions(inDay.length ? inDay : byScore, true) };
    }
    const earliest = Math.min(...last.chains.map((c) => ms(c.arr)));
    const earlier =
      start - Math.max(60 * MIN, Number.isFinite(earliest) ? earliest - by + 30 * MIN : 0);
    start = inDayFrom(start, earlier);
  }
  return { ...result(last), options: undefined, recommended: undefined };
}
