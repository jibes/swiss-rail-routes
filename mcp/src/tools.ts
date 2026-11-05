// The five tools: the app's planner and data, answered as JSON. Read-only: nothing about a
// request outlives the in-memory cache of its answer.
import { localParams, type GaData, type RouteTemplate } from '../../src/core/data';
import { encodeTripLink } from '../../src/core/export/tripLink';
import type { Reservations } from '../../src/core/planner/plan';
import { plan, zurichLocal, type PlannedChain, type PlanResult } from '../../src/core/planner/plan';
import type { Leg, Section, Tour } from '../../src/core/model';
import { delayMin } from '../../src/core/ojp/journey';
import { journeyQueryOf, parseJourneyQuery } from '../../src/core/ojp/request';
import { missedByDisruption, plannedRows } from '../../src/core/rows';
import {
  fold,
  placeByName,
  stopKey,
  type Stop,
  type StopMode,
  type StopSearch,
} from '../../src/core/stops';
import { newTrip, zurichTime } from '../../src/core/trip';
import type { Warning } from '../../src/core/warnings';
import { translate, type Lang } from '../../src/i18n';
import { buildRoute, routeLinkOf, ToolError, type RouteInput } from './route';
import { BusyError, type Timetable } from './worker';

export interface ToolDeps {
  index: StopSearch;
  timetable: Timetable;
  templates: RouteTemplate[];
  ga: GaData;
  publicUrl: string;
  now?: () => number;
  /** How long a call waits for a plan before answering "still planning". */
  waitMs?: number;
}

export type PlanInput = RouteInput & {
  options?: number;
  lang?: Lang;
  reservations?: Reservations;
  /** A scenic line asked for that cannot be ridden: no options and why, not another way. */
  strict?: boolean;
  /** With fewer options than found: the recommended one (default) or the first to leave. */
  pick?: 'recommended' | 'earliest';
  /** Scenic lines by daylight: said and ranked behind (preferred), or left out (required). */
  daylight?: 'preferred' | 'required';
};

export type MoreInput = Omit<PlanInput, 'departAt' | 'arriveBy' | 'options'> & {
  direction: 'earlier' | 'later';
  from: string;
};

/** A plan keeps its memory (and time) while it runs; more at once are asked to wait. */
const PLANS_AT_ONCE = 4;
const KEEP_PLAN_MS = 15 * 60_000;
const KEEP_PLANS = 50;
const WAIT_MS = 45_000;
const EARLIER_BY_MS = 120 * 60_000;

const KINDS: [string, StopMode[]][] = [
  ['train', ['TRAIN', 'RACK_RAILWAY']],
  ['boat', ['BOAT']],
  ['cable car', ['CABLE_RAILWAY', 'CABLE_CAR', 'CHAIRLIFT']],
  ['tram', ['TRAM', 'METRO']],
  ['bus', ['BUS']],
];
const kindOf = (s: Stop) =>
  KINDS.find(([, modes]) => modes.some((m) => s.modes.includes(m)))?.[0] ?? 'other';

const local = (iso?: string) => (iso ? zurichLocal(Date.parse(iso)) : undefined);
const minutes = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

function rideOf(s: Section) {
  return {
    type: 'ride' as const,
    line: s.line ?? s.category,
    category: s.category,
    product: s.product,
    number: s.number,
    mode: s.mode,
    journey: s.journey,
    ...(s.destination ? { destination: s.destination } : {}),
    from: {
      name: s.from.name,
      ref: stopKey(s.from.stopRef),
      dep: local(s.from.dep),
      ...(s.from.depEst ? { expectedDep: local(s.from.depEst) } : {}),
      platform: s.from.platform,
      ...(s.from.platformEst ? { platformExpected: s.from.platformEst } : {}),
    },
    to: {
      name: s.to.name,
      ref: stopKey(s.to.stopRef),
      arr: local(s.to.arr),
      ...(s.to.arrEst ? { expectedArr: local(s.to.arrEst) } : {}),
      platform: s.to.platform,
      ...(s.to.platformEst ? { platformExpected: s.to.platformEst } : {}),
    },
    stops: s.intermediate.map((c) => ({ name: c.name, arr: local(c.arr), dep: local(c.dep) })),
    ...(s.reservationRequired ? { reservationRequired: true } : {}),
  };
}

function warningOf(w: Warning, chain: PlannedChain, lang: Lang, templates: RouteTemplate[]) {
  const s =
    w.sectionIndex === undefined
      ? undefined
      : chain.connections[w.legIndex]?.sections[w.sectionIndex];
  const note =
    w.type === 'seasonal'
      ? templates.find((t) => t.id === w.params.template)?.season?.note[lang]
      : undefined;
  return {
    type: w.type,
    severity: w.severity,
    text: note ?? translate(lang, w.key, localParams(w.params, lang, templates)),
    ...(s ? { on: `${s.line ?? s.category ?? ''} ${s.from.name}–${s.to.name}`.trim() } : {}),
    ...((w.type === 'disruption' || w.type === 'disruption-away') && s?.notices?.length
      ? { operatorText: s.notices, ...noticeMore(s) }
      : {}),
  };
}

/** A notice beyond its headline (0.19.1): until when, the stops it names, the operator's remarks. */
function noticeMore(s: Section) {
  const info = s.noticeInfo ?? [];
  const until = info
    .map((i) => i.until)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const affected = [...new Set(info.flatMap((i) => i.affected ?? []))];
  const detail = info
    .map((i) => i.detail)
    .filter(Boolean)
    .join(' ');
  return {
    ...(until ? { validUntil: local(until) } : {}),
    ...(affected.length ? { affected } : {}),
    ...(detail ? { detail } : {}),
  };
}

/** A scenic line asked for and not ridden (`line-missed`). */
const missesLine = (c: PlannedChain) => c.warnings.some((w) => w.type === 'line-missed');

type Step =
  | ReturnType<typeof rideOf>
  | { type: 'walk'; minutes: number; from: string; to: string }
  | { type: 'stay'; at: string; minutes: number };

export function createTools(deps: ToolDeps) {
  const { index, timetable, templates, ga, publicUrl } = deps;
  const now = deps.now ?? Date.now;
  const waitMs = deps.waitMs ?? WAIT_MS;
  const stop = (ref: string) => index.byRef(ref);
  const place = placeByName(index);
  const nameOf = (ref: string) => index.byRef(stopKey(ref))?.name;

  interface Job {
    at: number;
    tour: Tour;
    running: boolean;
    done: Promise<PlanResult>;
  }
  const jobs = new Map<string, Job>();

  /** One plan per request: asked again with the same arguments, the same plan. */
  const planJob = (key: string, make: () => { tour: Tour; reservations?: Reservations }): Job => {
    const t = now();
    for (const [k, j] of jobs) if (!j.running && j.at < t - KEEP_PLAN_MS) jobs.delete(k);
    const known = jobs.get(key);
    if (known) return known;
    if ([...jobs.values()].filter((j) => j.running).length >= PLANS_AT_ONCE)
      throw new BusyError(30);
    const { tour, reservations } = make();
    const job: Job = {
      at: t,
      tour,
      running: true,
      done: plan(tour, {
        fetchTrips: (q) => timetable.trips(q),
        templates,
        ga,
        stop,
        place,
        reservations,
      }),
    };
    jobs.set(key, job);
    job.done.then(
      () => {
        job.running = false;
        if (jobs.size > KEEP_PLANS) jobs.delete(jobs.keys().next().value as string);
      },
      // Failed: asked again, it tries again.
      () => void jobs.delete(key),
    );
    return job;
  };

  /** The plan, or undefined if it is still running when the wait is over. */
  const waitFor = async (job: Job): Promise<PlanResult | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((r) => {
      timer = setTimeout(() => r(undefined), waitMs);
    });
    try {
      return await Promise.race([job.done, late]);
    } finally {
      clearTimeout(timer);
    }
  };

  const stillPlanning = (job: Job) => ({
    status: 'still_planning',
    afterSeconds: Math.round((now() - job.at) / 1000),
    message: 'The plan is not ready yet. Call this tool again with exactly the same arguments.',
  });

  const notReached = (tour: Tour, chain: PlannedChain) => {
    const rows = plannedRows(tour, chain.connections);
    return rows.flatMap((r, i) =>
      r.type === 'station' && r.missed
        ? [{ station: r.name, disruptionLikely: missedByDisruption(rows, i, chain.warnings) }]
        : [],
    );
  };

  const optionOf = async (
    tour: Tour,
    legs: Leg[],
    chain: PlannedChain,
    lang: Lang,
    recommended: boolean,
  ) => {
    const steps = chain.connections.flatMap((c, i): Step[] => {
      const own = c.sections.flatMap((s): Step[] =>
        s.mode === 'walk'
          ? s.walkMin && s.walkMin >= 1
            ? [{ type: 'walk' as const, minutes: s.walkMin, from: s.from.name, to: s.to.name }]
            : []
          : [rideOf(s)],
      );
      const stay = i < chain.connections.length - 1 ? legs[i]?.to.dwellMin : 0;
      return stay ? [...own, { type: 'stay' as const, at: legs[i]!.to.name, minutes: stay }] : own;
    });
    const rides = steps.filter((s) => s.type === 'ride').length;
    const trip = newTrip('mcp', tour, legs, chain, new Date(now()));
    return {
      ...(recommended ? { recommended: true } : {}),
      departure: local(chain.dep),
      arrival: local(chain.arr),
      durationMin: minutes(chain.dep, chain.arr),
      rides,
      changes: Math.max(0, rides - 1),
      legs: steps,
      warnings: chain.warnings.map((w) => warningOf(w, chain, lang, templates)),
      notReached: notReached(tour, chain),
      link: `${publicUrl}${await encodeTripLink(trip, nameOf)}`,
    };
  };

  const stationsOf = (tour: Tour) =>
    tour.waypoints.map((w) => ({
      name: w.name,
      ref: stopKey(w.stopRef),
      ...(w.kind === 'stop' ? { stay: w.dwellMin } : {}),
    }));

  const relaxedOf = (r: PlanResult) =>
    r.relaxed.map((x) => ({
      leg: x.legIndex + 1,
      from: r.legs?.[x.legIndex]?.from.name,
      to: r.legs?.[x.legIndex]?.to.name,
      rule: x.rule,
    }));

  const failed = (r: PlanResult): never => {
    const leg = r.failedLeg === undefined ? undefined : r.legs?.[r.failedLeg];
    throw new ToolError(
      leg
        ? `no connection on leg ${r.failedLeg! + 1} (${leg.from.name} → ${leg.to.name})`
        : 'no connection at that time',
    );
  };

  return {
    findStops({ query, limit }: { query: string; limit?: number }) {
      return {
        stops: index.search(query, Math.min(limit ?? 8, 50)).map((s) => ({
          ref: s.ref,
          name: s.name,
          kind: kindOf(s),
          lat: s.lat,
          lon: s.lon,
        })),
      };
    },

    listScenicLines({ query, lang }: { query?: string; lang?: Lang }) {
      const q = query ? fold(query) : '';
      const reservationOnly = (t: RouteTemplate) =>
        ga.supplementTrains.names.some((n) => fold(n).includes(fold(t.name.split(/[ -]/)[0]!)));
      const hit = (t: RouteTemplate) =>
        !q ||
        fold(t.name).includes(q) ||
        t.id.includes(q) ||
        t.chain.some((s) => fold(s.name).includes(q));
      return {
        lines: templates.filter(hit).map((t) => ({
          id: t.id,
          name: t.name,
          from: t.chain[0]!.name,
          to: t.chain.at(-1)!.name,
          mustPass: t.chain.filter((s) => t.mustPass.includes(s.ref)).map((s) => s.name),
          modes: t.modes,
          ...(t.season
            ? { season: { months: t.season.months, note: t.season.note[lang ?? 'en'] } }
            : {}),
          // Reservation-only trains run on the line under these names (Bernina Express on the
          // Bernina); regular trains run too, so the line itself needs none (reported 4 Nov 2026).
          ...(reservationOnly(t)
            ? {
                reservationOnlyTrains: true,
                reservationNote: translate(lang ?? 'en', 'reservationOnlyNote'),
              }
            : { reservationOnlyTrains: false }),
          /** Deprecated (0.18.1): `reservationOnlyTrains`, which says what it means. */
          reservation: reservationOnly(t),
        })),
      };
    },

    async planTrip(input: PlanInput) {
      const { options: want, lang = 'en', reservations, strict, pick, daylight, ...route } = input;
      const count = Math.max(1, Math.min(want ?? 3, 3));
      const key = JSON.stringify(['plan', route, reservations]);
      const job = planJob(key, () => ({
        tour: buildRoute(route, { index, templates, now: now() }),
        reservations,
      }));
      const r = await waitFor(job);
      if (!r) return stillPlanning(job);
      if (!r.options?.length || !r.legs) return failed({ ...r, legs: r.legs });
      const t = now();
      // Time passed since it was planned: what has left is no longer on offer.
      const left = r.options.filter((c) => Date.parse(c.dep) >= t);
      if (!left.length) throw new ToolError('every connection found has left: plan again');
      // Daylight required: an option riding a scenic line after dark is left out, and said when
      // that leaves none.
      const dark = (c: PlannedChain) => c.warnings.some((w) => w.type === 'line-after-dark');
      const open = daylight === 'required' ? left.filter((c) => !dark(c)) : left;
      if (!open.length)
        return {
          status: 'after_dark' as const,
          date: job.tour.date,
          stations: stationsOf(job.tour),
          options: [],
          reason: [
            ...new Set(
              left[0]!.warnings
                .filter((w) => w.type === 'line-after-dark')
                .map((w) => translate(lang, w.key, w.params)),
            ),
          ].join('; '),
          relaxed: relaxedOf(r),
        };
      // Strict: a line asked for that no option rides is said, not ridden another way.
      if (strict && open.every(missesLine))
        return {
          status: 'line_not_ridden' as const,
          date: job.tour.date,
          stations: stationsOf(job.tour),
          options: [],
          reason: open[0]!.warnings
            .filter((w) => w.type === 'line-missed')
            .map((w) => translate(lang, w.key, w.params))
            .join('; '),
          notReached: notReached(job.tour, open[0]!),
          relaxed: relaxedOf(r),
        };
      // An option that rides the lines asked for over one that does not (reported 5 Nov 2026).
      const riding = open.filter((c) => !missesLine(c));
      const among = riding.length ? riding : open;
      const best = among.includes(r.recommended!) ? r.recommended! : among[0]!;
      const byDep = [...open].sort((a, b) => Date.parse(a.dep) - Date.parse(b.dep));
      const first = pick === 'earliest' ? byDep[0]! : best;
      const others = byDep.filter((c) => c !== first && c !== best);
      const picked = [...new Set([first, best, ...others])]
        .slice(0, count)
        .sort((a, b) => Date.parse(a.dep) - Date.parse(b.dep));
      const shaped = await Promise.all(
        picked.map((c) => optionOf(job.tour, r.legs!, c, lang, c === best)),
      );
      const main = picked.includes(best) ? best : picked[0]!;
      return {
        date: job.tour.date,
        stations: stationsOf(job.tour),
        options: shaped,
        notReached: notReached(job.tour, main),
        relaxed: relaxedOf(r),
        link: shaped[picked.indexOf(main)]!.link,
        routeLink: routeLinkOf(job.tour, publicUrl),
      };
    },

    async moreOptions(input: MoreInput) {
      const { direction, from, lang = 'en', reservations, ...route } = input;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(from))
        throw new ToolError(`not a time (HH:MM): ${from}`);
      const key = JSON.stringify(['more', route, direction, from, reservations]);
      const job = planJob(key, () => {
        const tour = buildRoute(route, { index, templates, now: now() });
        const start = zurichLocal(
          (direction === 'earlier' ? -EARLIER_BY_MS : 60_000) + zurichTime(tour.date, from),
        );
        // Before today's date, or before now: from the earliest that can still be caught.
        const when = start.slice(0, 10) === tour.date ? start.slice(11, 16) : '00:00';
        return {
          tour: buildRoute(
            { ...route, date: tour.date, departAt: when },
            { index, templates, now: now() },
          ),
          reservations,
        };
      });
      const r = await waitFor(job);
      if (!r) return stillPlanning(job);
      if (!r.legs || r.failedLeg !== undefined) return failed(r);
      const t = now();
      const edge = zurichTime(job.tour.date, from);
      const fresh = (r.options ?? [])
        .filter((c) => Date.parse(c.dep) >= t)
        .filter((c) =>
          direction === 'earlier' ? Date.parse(c.dep) < edge : Date.parse(c.dep) > edge,
        )
        .sort((a, b) => Date.parse(a.dep) - Date.parse(b.dep));
      return {
        date: job.tour.date,
        options: await Promise.all(
          fresh.map((c) => optionOf(job.tour, r.legs!, c, lang, c === r.recommended)),
        ),
        relaxed: relaxedOf(r),
      };
    },

    async trainStatus({ journey, date }: { journey: string; date?: string }) {
      const dated = journeyQueryOf(journey);
      const q = parseJourneyQuery(dated ?? { journey, day: date });
      if (typeof q === 'string') throw new ToolError(`bad ${q === 'day' ? 'date' : 'journey'}`);
      const s = await timetable.journey(q);
      return {
        journey: q.journey,
        date: q.day,
        cancelled: s.cancelled,
        fetchedAt: zurichLocal(now()),
        stops: s.calls.map((c) => ({
          name: c.name,
          ref: c.key,
          plannedArr: local(c.arr),
          plannedDep: local(c.dep),
          expectedArr: local(c.arrEst),
          expectedDep: local(c.depEst),
          delayMin: delayMin(c, c.dep ? 'dep' : 'arr'),
          platform: c.platform,
          ...(c.platformPlanned && c.platform !== c.platformPlanned
            ? { platformChangedFrom: c.platformPlanned }
            : {}),
          passed: c.passed,
          ...(c.cancelled ? { notServed: true } : {}),
        })),
        notices: s.notices ?? [],
      };
    },
  };
}

export type Tools = ReturnType<typeof createTools>;
