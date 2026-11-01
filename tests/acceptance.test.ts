// SPEC §8 acceptance tours T1–T6 on recorded OJP answers (see tests/acceptance/ojp.ts).
import { describe, expect, it } from 'vitest';
import { calls } from '../src/core/planner/connection';
import { plan, type PlannedChain, type PlanResult } from '../src/core/planner/plan';
import { usesSegment } from '../src/core/segments';
import { FIXTURE_DATE, LIVE_URL, RECORD, ojpFor } from './acceptance/ojp';
import { acceptanceTours } from './acceptance/tours';
import { ga, index, ref, segments, templates } from './helpers/timetable';

const DATE = process.env.OJP_DATE ?? FIXTURE_DATE;
const tours = acceptanceTours(DATE);
const timeout = RECORD || LIVE_URL ? 600_000 : 20_000;
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
        segments,
        ga,
        stop: (r) => index.byRef(r),
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
      // Thusis–Preda is closed 29.10.–13.11.2026: either a replacement service with a
      // disruption warning, or the planner says it dropped the Albula stops.
      const out = r.recommended!;
      const disrupted = out.warnings.some((w) => w.type === 'disruption' && w.legIndex === 0);
      const relaxed = r.relaxed.some((x) => x.legIndex === 0);
      expect(disrupted || relaxed).toBe(true);
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
    for (const c of chains(r)) {
      expect(stopsOf(c, 0).has(ref('Rigi Kulm'))).toBe(true);
      const down = stopsOf(c, 1);
      expect(down.has(ref('Vitznau')) && down.has(ref('Luzern'))).toBe(true);
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

  it('T6 base tunnel: every chain over the mountain line', async () => {
    const r = await planned('T6');
    const base = segments.find((s) => s.id === 'gotthard-base')!;
    expect(chains(r).length).toBeGreaterThan(0);
    for (const c of chains(r)) {
      const seq = c.connections.flatMap((x) => calls(x).map((k) => k.key));
      expect(usesSegment(seq, base)).toBe(false);
      expect(seq).toContain(ref('Göschenen'));
      expect(seq).toContain(ref('Airolo'));
    }
  });
});
