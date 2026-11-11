// SPEC §8 acceptance tours T1–T6 on recorded OJP answers (see tests/acceptance/ojp.ts).
import { placeByName } from '../src/core/stops';
import { describe, expect, it } from 'vitest';
import { calls, visited } from '../src/core/planner/connection';
import { plannedRows } from '../src/core/rows';
import { plan, type PlannedChain, type PlanResult } from '../src/core/planner/plan';
import { addWaypoint, insertTemplate, newTour, setStop } from './helpers/edit';
import { liveState } from '../src/core/live';
import { zurichDateTime } from '../src/core/ojp/request';
import { mergeReplan, remainingRoute, replanPoint } from '../src/core/replan';
import { newTrip } from '../src/core/trip';
import { FIXTURE_DATE, LIVE_URL, RECORD, ojpFor } from './acceptance/ojp';
import { acceptanceTours } from './acceptance/tours';
import { ga, index, ref, templates } from './helpers/timetable';

const DATE = process.env.OJP_DATE ?? FIXTURE_DATE;
const tours = acceptanceTours(DATE);
const timeout = RECORD || LIVE_URL || process.env.OJP_RECORD_URL ? 600_000 : 20_000;
/** Checks that hold only on the recorded date (closures, daylight). */
const onFixtureDate = DATE === FIXTURE_DATE && !LIVE_URL;

const results = new Map<string, Promise<PlanResult>>();
const planned = (id: string) => {
  if (!results.has(id))
    results.set(
      id,
      plan(tours[id]!, {
        ...ojpFor(id),
        templates,
        ga,
        stop: (r) => index.byRef(r),
        place: placeByName(index),
      }),
    );
  return results.get(id)!;
};

const chains = (r: PlanResult) => r.options ?? [];
const stopsOf = (c: PlannedChain, leg?: number) =>
  new Set(
    c.connections
      .filter((_, i) => leg === undefined || i === leg)
      .flatMap((x) => calls(x).map((k) => k.key)),
  );

// Live runs go one tour at a time: the Worker allows 120 uncached requests a minute per IP.
const suite = LIVE_URL ? describe : describe.concurrent;

suite('acceptance tours', { timeout }, () => {
  it('T1 Graubünden loop: Albula out (or the closure said), Vereina back', async () => {
    const r = await planned('T1');
    expect(chains(r).length).toBeGreaterThan(0);
    for (const c of chains(r)) {
      const back = stopsOf(c, c.connections.length - 1);
      expect(back.has(ref('Klosters Platz')) && back.has(ref('Sagliains'))).toBe(true);
      expect(back.has(ref('Preda'))).toBe(false);
    }
    if (onFixtureDate) {
      // Thusis–Preda is closed 29.10.–13.11.2026: either the replacement buses, said as the
      // Albula by road, or the planner says it dropped the Albula stops. (Until 0.18.1 the
      // trains' notice "between Thusis and Preda" counted on the IR38 Chur–Thusis, a stretch it
      // does not ride; it is said as elsewhere on the train's route now.)
      const out = r.recommended!;
      const byRoad = out.warnings.some((w) => w.type === 'replacement-bus' && w.legIndex === 0);
      const relaxed = r.relaxed.some((x) => x.legIndex === 0);
      expect(byRoad || relaxed).toBe(true);
    }
  });

  it('T2 Oberalp loop: over the pass, back via Göschenen', async () => {
    const r = await planned('T2');
    expect(r.relaxed).toEqual([]);
    for (const c of chains(r)) {
      const all = stopsOf(c);
      for (const s of ['Ilanz', 'Oberalppass', 'Andermatt', 'Göschenen'])
        expect(all.has(ref(s)), s).toBe(true);
      expect(c.warnings.some((w) => w.type === 'seasonal')).toBe(true);
    }
  });

  it('T3 Voralpen + Brünig + Mürren: Wattwil and Biberbrugg, Brünig, the dwell kept', async () => {
    const r = await planned('T3');
    expect(r.relaxed).toEqual([]);
    for (const c of chains(r)) {
      const out = stopsOf(c, 0);
      expect(out.has(ref('Wattwil')) && out.has(ref('Biberbrugg'))).toBe(true);
      expect(stopsOf(c, 1).has(ref('Meiringen'))).toBe(true);
      const [a, b] = [c.connections[1]!, c.connections[2]!];
      expect(Date.parse(b.dep) - Date.parse(a.arr)).toBeGreaterThanOrEqual(60 * 60_000);
    }
  });

  it('T4 Rigi: up from Arth-Goldau, 45 min on top, down to Vitznau and on to Luzern', async () => {
    const r = await planned('T4');
    expect(r.relaxed).toEqual([]);
    for (const c of chains(r)) {
      expect(stopsOf(c, 0).has(ref('Rigi Kulm'))).toBe(true);
      // Vitznau to Luzern by boat (the Lake Lucerne line), to the pier and a walk to the station.
      const down = visited(c.connections[1]!);
      expect(down.has(ref('Vitznau')) && down.has(ref('Luzern'))).toBe(true);
      expect(c.connections[1]!.sections.some((s) => s.mode === 'boat')).toBe(true);
    }
    if (onFixtureDate)
      expect(r.recommended!.warnings.some((w) => w.type === 'seasonal')).toBe(true);
  });

  it('T5 non-GA: Wengen–Kleine Scheidegg flagged 50 % with GA', async () => {
    const r = await planned('T5');
    for (const c of chains(r)) expect(c.warnings.map((w) => w.key)).toContain('wGaHalf');
  });

  it('every tour offers options that leave at different times', async () => {
    for (const id of Object.keys(tours)) {
      const r = await planned(id);
      const deps = chains(r).map((c) => c.dep);
      expect(deps.length, id).toBeGreaterThan(0);
      expect(new Set(deps).size, id).toBe(deps.length);
      expect(chains(r), id).toContain(r.recommended);
    }
  });

  it('T5 an hour later starts later', async () => {
    const [a, b] = await Promise.all([planned('T5'), planned('T5L')]);
    expect(Date.parse(b.options![0]!.dep)).toBeGreaterThan(Date.parse(a.options![0]!.dep));
  });

  it('T5 replanned on the train: from the next stop, a spontaneous stay in Wengen', async () => {
    if (!onFixtureDate) return; // the point depends on the recorded timetable
    const r = await planned('T5');
    const trip = newTrip('t5', tours.T5!, r.legs!, r.recommended!, new Date(0));
    const now = Date.parse(zurichDateTime(`${DATE}T09:15`));
    const point = replanPoint(trip, liveState(trip.chain.connections, now), now)!;
    expect(point.stop.name).toBe('Zweilütschinen');
    const deps = { ...ojpFor('T5R'), templates, ga, stop: (x: string) => index.byRef(x) };
    const wengen = index.search('Wengen', 1)[0]!;
    let draft = remainingRoute(trip, point);
    // As the screen asks while you edit: the rest as it is, then with Wengen, then the stay.
    const rest = await plan(draft, deps);
    expect(rest.relaxed).toEqual([]);
    expect(stopsOf(rest.recommended!).has(ref('Kleine Scheidegg'))).toBe(true);
    draft = addWaypoint(
      draft,
      { stopRef: wengen.ref, name: wengen.name },
      draft.waypoints.length - 1,
    );
    const viaWengen = await plan(draft, deps);
    expect(viaWengen.relaxed).toEqual([]);
    expect(stopsOf(viaWengen.recommended!).has(wengen.ref)).toBe(true);
    draft = setStop(draft, 1, true); // 30 min, as the panel's Stay
    const again = await plan(draft, deps);
    expect(again.relaxed).toEqual([]);
    const v = mergeReplan(trip, point, again.legs!, again.recommended!);
    expect(v.chain!.connections).toHaveLength(3); // travelled, to Wengen, on to Kleine Scheidegg
    const [, toWengen, onward] = v.chain!.connections;
    expect(Date.parse(onward!.dep) - Date.parse(toWengen!.arr)).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it('T6 base tunnel: every chain over the mountain line', async () => {
    const r = await planned('T6');
    expect(chains(r).length).toBeGreaterThan(0);
    for (const c of chains(r)) {
      const seq = c.connections.flatMap((x) => calls(x).map((k) => k.key));
      expect(seq).toContain(ref('Göschenen'));
      expect(seq).toContain(ref('Airolo'));
    }
    // Asked from 08:00: the 08:05, not the 10:05 for a shorter ride (round 3, R3-3: waiting
    // after the time asked for costs as travel does).
    if (onFixtureDate)
      expect(Date.parse(r.recommended!.dep)).toBe(Date.parse(zurichDateTime(`${DATE}T08:05`)));
  });

  // Reported on the MCP, 5 Nov 2026: Chur, then the Albula, on 6 Nov (Thusis–Preda closed, an
  // express replacement bus Thusis–Preda): planned via the Vereina, recommended, not a word said.
  // The line's own bus rides it by road now: nothing let go, the bus said as the Albula by road.
  it('B1R the Albula asked for is ridden by its replacement bus, not dropped', async () => {
    const albula = templates.find((x) => x.id === 'albula')!;
    const route = {
      ...insertTemplate(newTour('b', '2026-11-06', { stopRef: ref('Chur'), name: 'Chur' }), albula),
      anchor: { departAt: '08:00' },
    };
    const r = await plan(route, {
      ...ojpFor('B1R'),
      templates,
      ga,
      stop: (x: string) => index.byRef(x),
      place: placeByName(index),
    });
    expect(r.relaxed).toEqual([]);
    const best = r.recommended!;
    const at = visited(best.connections[0]!);
    for (const s of ['Thusis', 'Filisur', 'Bergün/Bravuogn', 'Preda'])
      expect(at.has(ref(s)), s).toBe(true);
    expect(best.warnings.some((w) => w.type === 'replacement-bus')).toBe(true);
    expect(best.warnings.some((w) => w.type === 'line-missed')).toBe(false);
  });

  // Retest round 3, 6 Nov 2026: Interlaken Ost → Jungfraujoch with a GA said nothing, though the
  // Eiger Express and the Jungfraubahn from Eigergletscher are not the GA's. A cable car or cog
  // railway the fare data does not name is said as not known, never taken as covered.
  it('JJ a summit ride the GA data does not name is said as not known', async () => {
    const route = {
      ...newTour('j', DATE, { stopRef: ref('Interlaken Ost'), name: 'Interlaken Ost' }),
      anchor: { departAt: '08:00' },
    };
    const tour = addWaypoint(route, { stopRef: ref('Jungfraujoch'), name: 'Jungfraujoch' });
    const r = await plan(tour, {
      ...ojpFor('JJ'),
      templates,
      ga,
      stop: (x: string) => index.byRef(x),
      place: placeByName(index),
    });
    const unknown = r
      .recommended!.warnings.filter((w) => w.type === 'ga-unknown')
      .map((w) => `${w.params.from}–${w.params.to}`);
    if (!LIVE_URL)
      expect(unknown).toEqual([
        'Grindelwald Terminal–Eigergletscher',
        'Eigergletscher–Jungfraujoch',
      ]);
    // Live, the day's way up may differ (the Eiger Express closed in November: the WAB via
    // Kleine Scheidegg, which the GA data names): every summit ride still says something.
    const summit = r.recommended!.connections.flatMap((c) =>
      c.sections.filter((s) => s.mode === 'cog' || s.mode === 'cableCar' || s.category === 'CC'),
    );
    const said = r.recommended!.warnings.filter(
      (w) => w.type === 'ga-unknown' || w.type === 'not-ga',
    );
    expect(summit.length).toBeGreaterThan(0);
    expect(said.length).toBeGreaterThanOrEqual(summit.length);
  });

  // Lines added in 0.19.0, each planned end to end on the recorded day: every station the line
  // must pass is called at, nothing relaxed. Proves the must-pass stations are ones trains stop at.
  const lines: [string, string, string][] = [
    ['LMBE', 'mont-blanc-express', '09:00'],
    ['LNSTCM', 'nyon-la-cure', '09:00'],
    ['LCENTO', 'centovalli', '09:00'],
    ['LMOB', 'goldenpass-mob', '09:00'],
    ['LVIGNES', 'train-des-vignes', '10:00'],
  ];
  for (const [id, line, time] of lines)
    it(`${id} the ${line} line passes all its stations`, async () => {
      const t = templates.find((x) => x.id === line)!;
      const route = {
        ...insertTemplate(
          newTour('l', DATE, { stopRef: t.chain[0]!.ref, name: t.chain[0]!.name }),
          t,
        ),
        anchor: { departAt: time },
      };
      const r = await plan(route, {
        ...ojpFor(id),
        templates,
        ga,
        stop: (x) => index.byRef(x),
        place: placeByName(index),
      });
      expect(r.relaxed).toEqual([]);
      const chain = r.recommended!;
      const at = new Set(chain.connections.flatMap((c) => [...visited(c)]));
      for (const m of t.mustPass) expect(at, `${line}: ${m}`).toContain(m);
      // Every station of the line is reached, its end included: Domodossola's arrival comes as
      // `8301003_gen:missingSLOID_pf:31` and was said not reached (round 3, R3-4).
      expect(
        plannedRows(route, chain.connections).filter((x) => x.type === 'station' && x.missed),
      ).toEqual([]);
      // From 09:00 the 09:29, not the 13:29 a minute shorter (round 3, R3-2).
      if (line === 'nyon-la-cure' && onFixtureDate)
        expect(Date.parse(chain.dep)).toBe(Date.parse(zurichDateTime(`${DATE}T09:29`)));
      // The Centovalli's reservation advice is said as such, not as a disruption (round 3, R3-5).
      if (line === 'centovalli' && onFixtureDate) {
        const types = chain.warnings.map((w) => w.type);
        expect(types).toContain('reservation-advised');
        expect(types).not.toContain('disruption');
      }
      // The bus Martigny–Les Marécottes stands in for the line's first stretch, and the notice
      // "irregular service Martigny–Vallorcine" is on the train inside it (round 3, R3-6).
      if (line === 'mont-blanc-express' && onFixtureDate) {
        const types = chain.warnings.map((w) => w.type);
        expect(types).toContain('replacement-bus');
        expect(types).toContain('disruption');
        expect(types).not.toContain('disruption-away');
      }
      // Past the border the GA ends: said for Vallorcine–Chamonix.
      if (line === 'mont-blanc-express')
        expect(
          chain.warnings
            .filter((w) => w.type === 'not-ga')
            .map((w) => `${w.params.from}–${w.params.to}`),
        ).toEqual(['Le Châtelard-Frontière–Vallorcine (F)', 'Vallorcine (F)–Chamonix-Mont-Blanc']);
    });
});
