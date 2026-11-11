// The planner: round trips, loops, reservation trains, lines and legs, options (split from
// planner.test.ts, which outgrew 800 lines).
import { describe, expect, it } from 'vitest';
import {
  addWaypoint,
  insertTemplate,
  newTour,
  setDwell,
  setRoundTrip,
  setStop,
} from './helpers/edit';
import type { Tour } from '../src/core/model';
import {
  legRules,
  mergeRepeats,
  pickOptions,
  plan,
  type PlannedChain,
} from '../src/core/planner/plan';
import {
  entriesOf,
  insertEntries,
  lineEntries,
  lineTo,
  setEntryStay,
  stationEntry,
} from '../src/core/line';
import { DATE, conn, deps, index, ref, ride, templates } from './helpers/timetable';

const stop = (name: string) => ({ stopRef: ref(name), name });
const tpl = (id: string) => templates.find((t) => t.id === id)!;
const tour = (start: string, f: (t: Tour) => Tour, depart = '07:00'): Tour => ({
  ...f(newTour('t', DATE, stop(start))),
  anchor: { departAt: depart },
});

describe('round trips', () => {
  it('expands T1-style tours into legs at the turnaround', () => {
    const t = setRoundTrip(
      insertTemplate(
        insertTemplate(newTour('t', DATE, stop('Zürich HB')), tpl('albula')),
        tpl('bernina'),
      ),
      true,
    );
    const rules = legRules(t, { templates });
    expect(rules).toHaveLength(1);
    expect(rules[0]!.templates.map((x) => x.id)).toEqual(['albula', 'bernina']);
    expect(index.byRef(rules[0]!.mustPass[0]!)?.name).toBe('Chur');
  });
});

describe('loops turned', () => {
  // Chur → Albula line → St. Moritz → Chur without a stay: one leg from Chur to Chur, which
  // OJP cannot plan. The turn is St. Moritz, yours, not the middle of the line's own stations.
  const out = conn(
    ride('RE 1', [
      ['Chur', '08:00'],
      ['Thusis', '08:30'],
      ['Filisur', '09:00'],
      ['Bergün/Bravuogn', '09:10'],
      ['Preda', '09:30'],
      ['St. Moritz', '10:00'],
    ]),
  );
  const back = conn(
    ride('RE 2', [
      ['St. Moritz', '10:30'],
      ['Preda', '11:00'],
      ['Bergün/Bravuogn', '11:20'],
      ['Filisur', '11:30'],
      ['Thusis', '12:00'],
      ['Chur', '12:30'],
    ]),
  );
  // Built as the app builds it: the line after Chur, then Chur again at the end.
  const loop = ((): Tour => {
    let t = insertEntries(newTour('t', DATE), -1, [stationEntry(stop('Chur'))]);
    t = insertEntries(t, 0, lineEntries(tpl('albula')));
    t = insertEntries(t, entriesOf(t).length - 1, [stationEntry(stop('Chur'))]);
    return { ...t, anchor: { departAt: '07:30' } };
  })();

  it('a round trip on a line turns at your station, never at one of the line’s rings', async () => {
    const d = deps([out, back]);
    const r = await plan(loop, d.deps);
    expect(r.legs!.map((l) => `${l.from.name}>${l.to.name}`)).toEqual([
      'Chur>St. Moritz',
      'St. Moritz>Chur',
    ]);
    expect(r.recommended!.connections.map((c) => c.dep)).toEqual([out.dep, back.dep]);
    expect(r.relaxed).toEqual([]);
  });

  it('arrive by: the first try leaves room for both legs of a turned loop', async () => {
    const d = deps([out, back]);
    await plan({ ...loop, anchor: { arriveBy: '13:00' } }, d.deps);
    // 90 min a leg, two legs: asked from 10:00, not from 11:30 as for one leg.
    expect(d.tt.calls[0]!.time).toBe('2026-11-07T10:00');
  });
});

describe('reservation trains', () => {
  it('avoided also in an answer fetched for one chain alone', async () => {
    // Zürich → Chur (30 min stop) → St. Moritz. Two trains to Chur; from Chur six regular
    // trains within the hour (the first answer, full), then a panorama train and a regular
    // one. The chain off the later train to Chur finds nothing in the shared answer and asks
    // again: that answer, too, prefers the regular train.
    const first = (dep: string, arr: string, line = 'IC 3') =>
      conn(
        ride(line, [
          ['Zürich HB', dep],
          ['Chur', arr],
        ]),
      );
    const on = (line: string, dep: string, arr: string, extra = {}) =>
      conn(
        ride(
          line,
          [
            ['Chur', dep],
            ['St. Moritz', arr],
          ],
          extra,
        ),
      );
    const list = [
      first('07:37', '08:52'),
      first('08:37', '09:52'),
      ...['09:25', '09:35', '09:45', '09:55', '10:05', '10:15'].map((t, i) =>
        on('RE 1', t, `1${i}:00`),
      ),
      on('PE 9', '10:30', '12:10', { reservationRequired: true }),
      // The regular train later needs a change: a worse chain, still the one to take.
      conn(
        ride('RE 2', [
          ['Chur', '11:30'],
          ['Thusis', '12:00'],
        ]),
        ride('RE 3', [
          ['Thusis', '12:10'],
          ['St. Moritz', '13:30'],
        ]),
      ),
    ];
    const t = tour('Zürich HB', (x) => {
      const y = addWaypoint(addWaypoint(x, stop('Chur')), stop('St. Moritz'));
      return setDwell(setStop(y, 1, true), 1, 30);
    });
    const r = await plan(t, deps(list).deps);
    const trains = r.options!.flatMap((o) =>
      o.connections.flatMap((c) => c.sections.map((s) => `${s.category} ${s.number}`)),
    );
    expect(trains).not.toContain('PE 9');
    expect(trains).toContain('RE 2');
  });
});

describe('lines and legs', () => {
  it('lines without rings, back to back, each on its own leg (a Rigi day)', () => {
    let t = insertEntries(newTour('t', DATE), -1, [stationEntry(stop('Zürich HB'))]);
    t = insertEntries(t, 0, lineEntries(tpl('rigi-arth')));
    t = insertEntries(t, entriesOf(t).length - 1, lineEntries(tpl('rigi-vitznau')));
    t = insertEntries(t, entriesOf(t).length - 1, lineEntries(tpl('lake-lucerne')));
    t = insertEntries(t, entriesOf(t).length - 1, [stationEntry(stop('Zürich HB'))]);
    const kulm = entriesOf(t).findIndex((e) => e.w.name === 'Rigi Kulm');
    t = setEntryStay(t, kulm, 45);
    // Rigi Kulm stays one of yours (never a ring of the Arth line), and every line counts.
    expect(entriesOf(t).map((e) => e.w.name)).toContain('Rigi Kulm');
    const rules = legRules({ ...t, anchor: { departAt: '08:00' } }, { templates });
    expect(rules.map((r) => r.templates.map((x) => x.id).sort())).toEqual([
      ['rigi-arth'],
      ['lake-lucerne', 'rigi-vitznau'],
    ]);
  });

  it('a line is ridden its way: Lake Lucerne by boat, the train beside it only relaxed', async () => {
    let t = insertEntries(newTour('t', DATE), -1, [stationEntry(stop('Vitznau'))]);
    t = insertEntries(t, 0, lineEntries(tpl('lake-lucerne')));
    t = { ...t, anchor: { departAt: '09:00' } };
    const train = conn(
      ride('R 1', [
        ['Vitznau', '09:10'],
        ['Luzern', '09:50'],
      ]),
    );
    const boat = conn(
      ride(
        'BAT 1',
        [
          ['Vitznau', '09:30'],
          ['Luzern', '10:30'],
        ],
        { mode: 'boat' },
      ),
    );
    const both = await plan(t, deps([train, boat]).deps);
    expect(both.recommended!.connections[0]!.sections[0]!.mode).toBe('boat');
    expect(both.relaxed).toEqual([]);
    const trainOnly = await plan(t, deps([train]).deps);
    expect(trainOnly.relaxed).toEqual([{ legIndex: 0, rule: 'mustPass' }]);
  });

  it('a line added from where you are is a line', () => {
    let t = insertEntries(newTour('t', DATE), -1, [stationEntry(stop('Vitznau'))]);
    t = insertEntries(t, 0, lineEntries(tpl('lake-lucerne')));
    const e = entriesOf(t);
    expect(e.map((x) => x.w.name)).toEqual(['Vitznau', 'Luzern']);
    expect(lineTo(e, 1)).toBe('lake-lucerne');
  });

  it('a line’s rules stay on its own leg, not the next one from its end station', () => {
    let t = insertEntries(newTour('t', DATE), -1, [stationEntry(stop('Chur'))]);
    t = insertEntries(t, 0, lineEntries(tpl('albula')));
    t = insertEntries(t, 1, lineEntries(tpl('vereina'), true));
    t = setEntryStay(t, 1, 60);
    const rules = legRules({ ...t, anchor: { departAt: '08:00' } }, { templates });
    expect(rules.map((r) => r.templates.map((x) => x.id))).toEqual([['albula'], ['vereina']]);
  });
});

describe('repeated stops', () => {
  it('merges consecutive waypoints at one stop, keeping the stop and the longer dwell', () => {
    const t: Tour = {
      ...newTour('t', DATE),
      waypoints: [
        { ...stop('Zürich HB'), kind: 'start', dwellMin: 0 },
        { ...stop('Luzern'), kind: 'via', dwellMin: 0 },
        { ...stop('Luzern'), kind: 'stop', dwellMin: 60, templateId: 'bruenig' },
        { ...stop('Bern'), kind: 'end', dwellMin: 0 },
        { ...stop('Bern'), kind: 'end', dwellMin: 0 },
      ],
    };
    const m = mergeRepeats(t);
    expect(m.waypoints.map((w) => `${w.name}:${w.kind}:${w.dwellMin}`)).toEqual([
      'Zürich HB:start:0',
      'Luzern:stop:60',
      'Bern:end:0',
    ]);
    expect(m.waypoints[1]!.templateId).toBe('bruenig');
  });

  it('never asks OJP for a leg from a stop to itself', async () => {
    const c = conn(
      ride('IR 70', [
        ['Zürich HB', '08:04'],
        ['Luzern', '08:45'],
      ]),
    );
    const t: Tour = {
      ...newTour('t', DATE),
      anchor: { departAt: '08:00' },
      waypoints: [
        { ...stop('Zürich HB'), kind: 'start', dwellMin: 0 },
        { ...stop('Zürich HB'), kind: 'via', dwellMin: 0 },
        { ...stop('Luzern'), kind: 'end', dwellMin: 0 },
      ],
    };
    const d = deps([c]);
    const r = await plan(t, d.deps);
    expect(r.recommended?.dep).toBe(c.dep);
    expect(d.tt.calls.every((q) => q.origin.ref !== q.destination.ref)).toBe(true);
  });
});

describe('planned legs', () => {
  it('returns the legs it planned, one per connection, also for a turned loop', async () => {
    // Zürich → Luzern → Zürich without a stop: the planner turns at Luzern (2 legs, 1 in the tour).
    const out = conn(
      ride('IR 70', [
        ['Zürich HB', '08:04'],
        ['Luzern', '08:45'],
      ]),
    );
    const back = conn(
      ride('IR 75', [
        ['Luzern', '09:05'],
        ['Zürich HB', '09:46'],
      ]),
    );
    const t = tour('Zürich HB', (x) => setRoundTrip(addWaypoint(x, stop('Luzern')), true), '08:00');
    const r = await plan(t, deps([out, back]).deps);
    expect(r.legs!.map((l) => `${l.from.name}>${l.to.name}`)).toEqual([
      'Zürich HB>Luzern',
      'Luzern>Zürich HB',
    ]);
    for (const c of r.options!) expect(c.connections).toHaveLength(r.legs!.length);
  });
});

describe('options', () => {
  const chain = (dep: string, score: number): PlannedChain => ({
    connections: [],
    warnings: [],
    score,
    dep: `2026-11-07T${dep}:00Z`,
    arr: `2026-11-07T18:00:00Z`,
  });

  it('offers up to 3 departures: the best, the earliest and the latest other, by time', () => {
    const r = pickOptions([
      chain('08:00', 50),
      chain('07:00', 80),
      chain('09:00', 60),
      chain('10:00', 90),
      chain('07:00', 70),
    ]);
    expect(r.options!.map((c) => [c.dep.slice(11, 16), c.score])).toEqual([
      ['07:00', 70],
      ['08:00', 50],
      ['10:00', 90],
    ]);
    expect(r.recommended!.dep).toContain('08:00');
  });

  it('never repeats a departure', () => {
    const r = pickOptions([chain('08:00', 50), chain('08:00', 40)]);
    expect(r.options).toHaveLength(1);
    expect(r.recommended!.score).toBe(40);
  });

  it('plans options with different departures when the timetable has them', async () => {
    const l1 = ['07:04', '08:04', '09:04'].map((d, i) =>
      conn(
        ride('IR 70', [
          ['Zürich HB', d],
          ['Luzern', `0${7 + i}:45`],
        ]),
      ),
    );
    const t = tour('Zürich HB', (x) => addWaypoint(x, stop('Luzern')), '07:00');
    const r = await plan(t, deps(l1).deps);
    const deps_ = r.options!.map((c) => c.dep);
    expect(new Set(deps_).size).toBe(deps_.length);
    expect(r.options).toHaveLength(3);
  });
});

// Reported 4 Nov 2026: the 14:19 home from Le Châtelard lost to the 19:19, its IR90 Martigny →
// Lausanne flagged for works between Lausanne and Genève-Aéroport, which it does not ride.
describe('a notice about another stretch of the train', () => {
  it('does not change which connection is recommended', async () => {
    const works = {
      situationIds: ['s1'],
      notices: ['Der Bahnverkehr zwischen Lausanne und Genève-Aéroport ist eingeschränkt.'],
    };
    const early = conn(
      ride(
        'IR 90',
        [
          ['Martigny', '14:19'],
          ['Montreux', '14:52'],
          ['Lausanne', '15:18'],
        ],
        works,
      ),
    );
    const late = conn(
      ride('IR 90', [
        ['Martigny', '19:19'],
        ['Montreux', '19:52'],
        ['Lausanne', '20:18'],
      ]),
    );
    const t: Tour = {
      ...newTour('t', DATE, stop('Martigny')),
      anchor: { departAt: '14:00' },
      waypoints: [
        { ...stop('Martigny'), kind: 'start', dwellMin: 0 },
        { ...stop('Lausanne'), kind: 'end', dwellMin: 0 },
      ],
    };
    const r = await plan(t, deps([early, late]).deps);
    expect(r.recommended!.connections[0]!.dep).toBe(early.dep);
    expect(r.recommended!.warnings.map((w) => w.type)).toContain('disruption-away');
  });
});

// Sparse lines (Le Châtelard on a Sunday): the connection after the one planned, from the same
// answers, said when it leaves over two hours later; nothing when the answers hold none later.
describe('the next connection, when it is far off', () => {
  const ir = (dep: string, arr: string) =>
    conn(
      ride('IR 90', [
        ['Martigny', dep],
        ['Lausanne', arr],
      ]),
    );
  const trip = (depart: string): Tour => ({
    ...newTour('t', DATE, stop('Martigny')),
    anchor: { departAt: depart },
    waypoints: [
      { ...stop('Martigny'), kind: 'start', dwellMin: 0 },
      { ...stop('Lausanne'), kind: 'end', dwellMin: 0 },
    ],
  });
  const sparse = (r: Awaited<ReturnType<typeof plan>>) =>
    r.recommended!.warnings.filter((w) => w.type === 'sparse');

  it('says when and how much later the next one leaves', async () => {
    const r = await plan(trip('14:00'), deps([ir('14:19', '15:18'), ir('18:49', '19:48')]).deps);
    const [w] = sparse(r);
    expect(w).toMatchObject({
      severity: 'info',
      key: 'wSparse',
      params: { gap: '4 h 30 min', at: '18:49' },
    });
    expect(w!.sectionIndex).toBe(0);
  });

  it('says nothing within two hours, nor when none later is known', async () => {
    expect(
      sparse(await plan(trip('14:00'), deps([ir('14:19', '15:18'), ir('16:19', '17:18')]).deps)),
    ).toEqual([]);
    expect(sparse(await plan(trip('14:00'), deps([ir('14:19', '15:18')]).deps))).toEqual([]);
  });

  it('is not counted against the plan', async () => {
    const r = await plan(trip('14:00'), deps([ir('14:19', '15:18'), ir('18:49', '19:48')]).deps);
    expect(r.recommended!.connections[0]!.dep).toContain('14:19');
  });
});
