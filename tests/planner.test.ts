import { describe, expect, it } from 'vitest';
import { addWaypoint, insertTemplate, newTour, setRoundTrip, setStop } from '../src/core/edit';
import type { Tour } from '../src/core/model';
import { legRules, mergeRepeats, plan } from '../src/core/planner/plan';
import { DATE, conn, deps, index, ref, ride, templates } from './helpers/timetable';

const stop = (name: string) => ({ stopRef: ref(name), name });
const tpl = (id: string) => templates.find((t) => t.id === id)!;
const tour = (start: string, f: (t: Tour) => Tour, depart = '07:00'): Tour => ({
  ...f(newTour('t', DATE, stop(start))),
  anchor: { departAt: depart },
});

// Zürich → Lugano: base tunnel (fast) and mountain line via Göschenen/Airolo.
const base = (dep: string, arr: string) =>
  conn(
    ride('IC 2', [
      ['Zürich HB', dep],
      ['Arth-Goldau', dep],
      ['Bellinzona', arr],
      ['Lugano', arr],
    ]),
  );
const mountain = (dep: string, arr: string) =>
  conn(
    ride('IR 26', [
      ['Zürich HB', dep],
      ['Arth-Goldau', dep],
      ['Erstfeld', dep],
      ['Göschenen', dep],
      ['Airolo', arr],
      ['Bellinzona', arr],
      ['Lugano', arr],
    ]),
  );

describe('line enforcement (T6)', () => {
  const list = [base('08:09', '10:08'), mountain('08:18', '11:20'), base('09:09', '11:08')];

  it('rejects base-tunnel candidates when the mountain-line template is chosen', async () => {
    const t = tour('Zürich HB', (x) =>
      insertTemplate(addWaypoint(x, stop('Lugano')), tpl('gotthard-bergstrecke')),
    );
    // Template ends at Bellinzona; plan Zürich → Lugano through it.
    const { deps: d } = deps(list.map((c) => c));
    const rules = legRules(t, d);
    expect(rules.at(-1)!.avoid.map((s) => s.id)).toContain('gotthard-base');
    const tt = deps(list);
    const simple: Tour = {
      ...newTour('t', DATE, stop('Zürich HB')),
      anchor: { departAt: '08:00' },
      waypoints: [
        { ...stop('Zürich HB'), kind: 'start', dwellMin: 0 },
        { ...stop('Göschenen'), kind: 'via', dwellMin: 0, templateId: 'gotthard-bergstrecke' },
        { ...stop('Airolo'), kind: 'via', dwellMin: 0, templateId: 'gotthard-bergstrecke' },
        { ...stop('Lugano'), kind: 'end', dwellMin: 0 },
      ],
    };
    const r = await plan(simple, tt.deps);
    expect(r.recommended!.connections[0]!.sections[0]!.category).toBe('IR');
    expect(r.relaxed).toEqual([]);
    expect(tt.tt.calls[0]!.vias.map((v) => v.name)).toEqual(['Göschenen', 'Airolo']);
  });

  it('takes the fast train without the template', async () => {
    const t = tour('Zürich HB', (x) => addWaypoint(x, stop('Lugano')), '08:00');
    const r = await plan(t, deps(list).deps);
    expect(r.recommended!.connections[0]!.sections[0]!.category).toBe('IC');
    expect(r.earliest!.dep).toBe(list[0]!.dep);
    expect(r.latest!.dep).toBe(list[2]!.dep);
  });
});

describe('chaining with dwell', () => {
  // Zürich → Luzern (stop 60) → Bern
  const l1 = [
    conn(
      ride('IR 70', [
        ['Zürich HB', '07:04'],
        ['Luzern', '07:45'],
      ]),
    ),
    conn(
      ride('IR 70', [
        ['Zürich HB', '08:04'],
        ['Luzern', '08:45'],
      ]),
    ),
  ];
  const l2 = [
    conn(
      ride('IR 15', [
        ['Luzern', '08:35'],
        ['Bern', '09:35'],
      ]),
    ),
    conn(
      ride('IR 15', [
        ['Luzern', '09:35'],
        ['Bern', '10:35'],
      ]),
    ),
    conn(
      ride('IR 15', [
        ['Luzern', '10:35'],
        ['Bern', '11:35'],
      ]),
    ),
  ];
  const t = tour('Zürich HB', (x) =>
    setStop(addWaypoint(addWaypoint(x, stop('Luzern')), stop('Bern')), 1, true, 60),
  );

  it('leaves each stop no earlier than arrival + dwell', async () => {
    const r = await plan(t, deps([...l1, ...l2]).deps);
    for (const c of [r.earliest!, r.recommended!, r.latest!]) {
      const [a, b] = c.connections;
      expect(Date.parse(b!.dep) - Date.parse(a!.arr)).toBeGreaterThanOrEqual(60 * 60_000);
    }
    expect(r.earliest!.arr).toBe(l2[1]!.arr);
    expect(r.latest!.dep).toBe(l1[1]!.dep);
  });

  it('reports the failing leg', async () => {
    const r = await plan(t, deps(l1).deps);
    expect(r.failedLeg).toBe(1);
    expect(r.recommended).toBeUndefined();
  });

  it('plans backwards from an arrive-by time', async () => {
    const r = await plan({ ...t, anchor: { arriveBy: '11:00' } }, deps([...l1, ...l2]).deps);
    expect(Date.parse(r.recommended!.arr)).toBeLessThanOrEqual(Date.parse(l2[1]!.arr));
  });
});

describe('relaxation', () => {
  it('drops must-pass only when nothing passes, and says so', async () => {
    const t: Tour = {
      ...newTour('t', DATE),
      anchor: { departAt: '08:00' },
      waypoints: [
        { ...stop('Zürich HB'), kind: 'start', dwellMin: 0 },
        { ...stop('Göschenen'), kind: 'via', dwellMin: 0 },
        { ...stop('Lugano'), kind: 'end', dwellMin: 0 },
      ],
    };
    const r = await plan(t, deps([base('08:09', '10:08')]).deps);
    expect(r.recommended).toBeDefined();
    expect(r.relaxed).toEqual([{ legIndex: 0, rule: 'mustPass' }]);
  });
});

describe('supplement trains', () => {
  it('prefers the regular train on the same line', async () => {
    const bex = conn(
      ride(
        'BEX 951',
        [
          ['St. Moritz', '08:47'],
          ['Alp Grüm', '09:50'],
          ['Tirano', '11:15'],
        ],
        {
          reservationRequired: true,
        },
      ),
    );
    const r1 = conn(
      ride('R 1631', [
        ['St. Moritz', '09:00'],
        ['Alp Grüm', '10:05'],
        ['Tirano', '11:30'],
      ]),
    );
    const t = tour('St. Moritz', (x) => addWaypoint(x, stop('Tirano')), '08:30');
    const r = await plan(t, deps([bex, r1]).deps);
    for (const c of [r.earliest!, r.recommended!, r.latest!])
      expect(c.connections[0]!.sections[0]!.category).toBe('R');
  });
});

describe('warnings', () => {
  it('flags the non-GA section with the 50 % hint (T5)', async () => {
    const c = conn(
      ride('R 1', [
        ['Interlaken Ost', '09:05'],
        ['Lauterbrunnen', '09:25'],
      ]),
      ride('R 2', [
        ['Lauterbrunnen', '09:27'],
        ['Wengen', '09:40'],
        ['Kleine Scheidegg', '10:10'],
      ]),
    );
    const t = tour('Interlaken Ost', (x) => addWaypoint(x, stop('Kleine Scheidegg')), '09:00');
    const r = await plan(t, deps([c]).deps);
    const keys = r.recommended!.warnings.map((w) => w.key);
    expect(keys).toContain('wGaHalf');
    expect(keys).toContain('wTightTransfer');
    expect(
      await plan({ ...t, ticket: 'none' }, deps([c]).deps).then((x) =>
        x.recommended!.warnings.map((w) => w.key),
      ),
    ).not.toContain('wGaHalf');
  });

  it('warns when a highlight is passed after sunset, and scores it', async () => {
    const albulaRide = (dep: string, mid: string, arr: string) =>
      conn(
        ride('RE 1141', [
          ['Chur', dep],
          ['Thusis', dep],
          ['Filisur', mid],
          ['Bergün/Bravuogn', mid],
          ['Preda', mid],
          ['St. Moritz', arr],
        ]),
      );
    const day = albulaRide('12:58', '14:00', '15:00');
    const dusk = albulaRide('15:58', '17:00', '18:00');
    const t: Tour = {
      ...newTour('t', DATE),
      anchor: { departAt: '12:00' },
      waypoints: insertTemplate(newTour('t', DATE), tpl('albula')).waypoints,
    };
    const r = await plan(t, deps([day, dusk]).deps);
    expect(r.recommended!.dep).toBe(day.dep);
    const late = r.latest!.warnings.filter((w) => w.type === 'after-sunset');
    expect(late.map((w) => w.params.name)).toContain('Landwasserviadukt');
    expect(r.recommended!.warnings.some((w) => w.type === 'after-sunset')).toBe(false);
  });

  it('marks disrupted sections and seasonal templates', async () => {
    const c = conn(
      ride(
        'PE 1',
        [
          ['Disentis/Mustér', '10:00'],
          ['Oberalppass', '10:50'],
          ['Andermatt', '11:10'],
        ],
        {
          situationIds: ['s1'],
        },
      ),
    );
    const t: Tour = {
      ...newTour('t', DATE),
      anchor: { departAt: '09:30' },
      waypoints: insertTemplate(newTour('t', DATE), tpl('oberalp')).waypoints,
    };
    const r = await plan(t, deps([c]).deps);
    const types = r.recommended!.warnings.map((w) => w.type);
    expect(types).toContain('disruption');
    expect(types).toContain('seasonal');
  });
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
    const rules = legRules(t, { templates, segments: [] });
    expect(rules).toHaveLength(1);
    expect(rules[0]!.templates.map((x) => x.id)).toEqual(['albula', 'bernina']);
    expect(index.byRef(rules[0]!.mustPass[0]!)?.name).toBe('Chur');
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
    for (const c of [r.earliest!, r.recommended!, r.latest!])
      expect(c.connections).toHaveLength(r.legs!.length);
  });
});
