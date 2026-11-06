import { describe, expect, it } from 'vitest';
import {
  addWaypoint,
  insertTemplate,
  newTour,
  setDwell,
  setRoundTrip,
  setStop,
} from './helpers/edit';
import type { Connection, Tour } from '../src/core/model';
import {
  legRules,
  mergeRepeats,
  pickOptions,
  plan,
  zurichLocal,
  type PlannedChain,
  type PlanResult,
} from '../src/core/planner/plan';
import {
  entriesOf,
  insertEntries,
  lineEntries,
  lineTo,
  setEntryStay,
  stationEntry,
} from '../src/core/line';
import { visited } from '../src/core/planner/connection';
import { stopKey } from '../src/core/stops';
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
    expect(rules.at(-1)!.templates.map((x) => x.id)).toContain('gotthard-bergstrecke');
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
    expect(r.options![0]!.dep).toBe(list[0]!.dep);
    expect(r.options!.at(-1)!.dep).toBe(list[2]!.dep);
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
    for (const c of r.options!) {
      const [a, b] = c.connections;
      expect(Date.parse(b!.dep) - Date.parse(a!.arr)).toBeGreaterThanOrEqual(60 * 60_000);
    }
    expect(r.options![0]!.arr).toBe(l2[1]!.arr);
    expect(r.options!.at(-1)!.dep).toBe(l1[1]!.dep);
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

describe('arrive by, with long legs', () => {
  // Zürich → Lugano every hour, 5 h each way: the old first try (90 min a leg) found nothing.
  const slow = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00'].map((d) =>
    conn(
      ride('IC 2', [
        ['Zürich HB', d],
        ['Lugano', `${String(Number(d.slice(0, 2)) + 5).padStart(2, '0')}:00`],
      ]),
    ),
  );
  const t = tour('Zürich HB', (x) => addWaypoint(x, stop('Lugano')));

  it('steps back far enough and offers every chain that arrives in time', async () => {
    const r = await plan({ ...t, anchor: { arriveBy: '16:00' } }, deps(slow).deps);
    expect(r.options?.length).toBeGreaterThan(0);
    for (const c of r.options!)
      expect(Date.parse(c.arr)).toBeLessThanOrEqual(Date.parse(slow[5]!.arr));
    expect(r.options!.some((c) => c.dep === slow[5]!.dep)).toBe(true);
  });
});

describe('arrive by, equally good trains', () => {
  it('recommends the one leaving last, not an hour early', async () => {
    const half = ['15:30', '16:00', '16:30', '17:00', '17:30', '18:00'].map((d) => {
      const [h, m] = d.split(':').map(Number) as [number, number];
      const a = h * 60 + m + 30;
      const arr = `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
      return conn(
        ride('IR 70', [
          ['Zürich HB', d],
          ['Luzern', arr],
        ]),
      );
    });
    const t = tour('Zürich HB', (x) => addWaypoint(x, stop('Luzern')));
    const r = await plan({ ...t, anchor: { arriveBy: '18:00' } }, deps(half).deps);
    expect(r.recommended!.dep).toBe(half[4]!.dep); // 17:30 → 18:00
  });
});

describe('arrive by, a day trip', () => {
  const onDay = (c: Connection, date: string): Connection =>
    JSON.parse(JSON.stringify(c).replaceAll(DATE, date)) as Connection;
  const line = (from: string, to: string, category: string) => (dep: string, arr: string) =>
    conn(
      ride(category, [
        [from, dep],
        [to, arr],
      ]),
    );
  const out = line('Zürich HB', 'Lugano', 'IC 2');
  const back = line('Lugano', 'Zürich HB', 'IC 21');
  const panorama = (dep: string, arr: string): Connection => {
    const c = back(dep, arr);
    return { ...c, sections: [{ ...c.sections[0]!, reservationRequired: true }] };
  };
  const leaves = (r: PlanResult) => r.options?.map((c) => zurichLocal(Date.parse(c.dep)));
  const stay = (arriveBy: string, min = 120): Tour => {
    const x = setRoundTrip(
      addWaypoint(newTour('t', DATE, stop('Zürich HB')), stop('Lugano')),
      true,
    );
    const i = x.waypoints.findLastIndex((w) => w.name === 'Lugano');
    return { ...setDwell(setStop(x, i, true), i, min), anchor: { arriveBy } };
  };
  // From the afternoon the next train back is tomorrow's: the first try is most of a day late.
  const outs = [
    onDay(out('20:00', '23:30'), '2026-11-06'),
    out('01:05', '09:00'),
    out('06:07', '11:00'),
    out('07:07', '12:00'),
    out('17:07', '22:00'),
  ];
  const tomorrow = onDay(back('12:00', '17:22'), '2026-11-08');

  it('stays on the day although the first try is a whole night late', async () => {
    const d = deps([...outs, back('14:00', '19:00'), back('15:00', '20:00'), tomorrow]);
    const r = await plan(stay('21:00'), d.deps);
    expect(leaves(r)).toEqual([`${DATE}T06:07`, `${DATE}T07:07`]);
    expect(zurichLocal(Date.parse(r.recommended!.dep))).toBe(`${DATE}T07:07`);
    expect(d.tt.calls.every((q) => q.time >= `${DATE}T05:00`)).toBe(true);
  });

  it('asks from the day’s start when the stay would put the first try before it', async () => {
    const d = deps([out('06:07', '07:00'), back('12:15', '12:55')]);
    const r = await plan(stay('13:00', 310), d.deps);
    expect(d.tt.calls[0]!.time).toBe(`${DATE}T05:00`);
    expect(leaves(r)).toEqual([`${DATE}T06:07`]);
  });

  it('takes a train that needs a reservation before leaving in the night', async () => {
    const pe = panorama('14:30', '19:30');
    const r = await plan(stay('19:45'), deps([...outs, pe, back('15:00', '20:00'), tomorrow]).deps);
    expect(leaves(r)).toEqual([`${DATE}T06:07`, `${DATE}T07:07`]);
    expect(r.recommended!.connections[1]!.dep).toBe(pe.dep);
  });

  it('keeps to regular trains when they arrive in time', async () => {
    const pe = panorama('14:30', '19:30');
    const r = await plan(stay('21:00'), deps([...outs, pe, back('15:00', '20:00'), tomorrow]).deps);
    expect(r.options!.length).toBeGreaterThan(0);
    for (const c of r.options!) expect(c.connections[1]!.dep).not.toBe(pe.dep);
  });

  it('leaves in the night when nothing else arrives in time', async () => {
    const d = deps([...outs, back('11:00', '14:00'), back('14:00', '19:00'), tomorrow]);
    const r = await plan(stay('15:00'), d.deps);
    expect(leaves(r)).toEqual([`${DATE}T01:05`]);
  });

  it('drops a night departure when the same try also finds one by day', async () => {
    const luzern = line('Zürich HB', 'Luzern', 'IC 2');
    const found = [luzern('03:30', '04:30'), luzern('06:07', '07:00')];
    const x = addWaypoint(newTour('t', DATE, stop('Zürich HB')), stop('Luzern'));
    const r = await plan(
      { ...x, anchor: { arriveBy: '08:00' } },
      {
        ...deps([]).deps,
        fetchTrips: async (q) => (q.time < `${DATE}T03:30` ? found : []),
      },
    );
    expect(leaves(r)).toEqual([`${DATE}T06:07`]);
  });

  it('an arrival before the day’s start may leave the evening before', async () => {
    const late = onDay(out('22:00', '23:30'), '2026-11-06');
    const x = addWaypoint(newTour('t', DATE, stop('Zürich HB')), stop('Lugano'));
    const r = await plan({ ...x, anchor: { arriveBy: '00:30' } }, deps([late]).deps);
    expect(r.recommended?.dep).toBe(late.dep);
  });
});

describe('reservation trains, your choice', () => {
  const line = (from: string, to: string, category: string) => (dep: string, arr: string) =>
    conn(
      ride(category, [
        [from, dep],
        [to, arr],
      ]),
    );
  const out = line('Zürich HB', 'Lugano', 'IC 2');
  const back = line('Lugano', 'Zürich HB', 'IC 21');
  const panorama = (dep: string, arr: string): Connection => {
    const c = back(dep, arr);
    return { ...c, sections: [{ ...c.sections[0]!, reservationRequired: true }] };
  };
  const stay = (anchor: Tour['anchor']): Tour => {
    const x = setRoundTrip(
      addWaypoint(newTour('t', DATE, stop('Zürich HB')), stop('Lugano')),
      true,
    );
    const i = x.waypoints.findLastIndex((w) => w.name === 'Lugano');
    return { ...setDwell(setStop(x, i, true), i, 120), anchor };
  };
  const pe = panorama('14:30', '19:30');
  const regular = back('15:00', '21:00');
  // From the afternoon the next train back is tomorrow's, as OJP answers.
  const tomorrow = JSON.parse(
    JSON.stringify(back('12:00', '17:22')).replaceAll(DATE, '2026-11-08'),
  ) as Connection;
  const list = [out('07:07', '12:00'), out('17:07', '22:00'), pe, regular, tomorrow];
  const backOf = (r: PlanResult) => r.recommended?.connections[1]?.dep;

  it('avoid is the default, and takes the regular train that also arrives in time', async () => {
    const t = stay({ arriveBy: '21:30' });
    const plain = await plan(t, deps(list).deps);
    const avoid = await plan(t, { ...deps(list).deps, reservations: 'avoid' });
    expect(backOf(plain)).toBe(regular.dep);
    expect(backOf(avoid)).toBe(regular.dep);
  });

  it('include lets it compete: the shorter chain wins', async () => {
    const t = stay({ departAt: '07:00' });
    const r = await plan(t, { ...deps(list).deps, reservations: 'include' });
    expect(backOf(r)).toBe(pe.dep);
    expect(r.recommended!.warnings.some((w) => w.type === 'reservation')).toBe(true);
  });

  it('never leaves it out, even when that leaves no connection', async () => {
    const r = await plan(stay({ departAt: '07:00' }), {
      ...deps([out('07:07', '12:00'), pe]).deps,
      reservations: 'never',
    });
    expect(r.options).toBeUndefined();
    expect(r.failedLeg).toBe(1);
  });

  it('never also holds when a chain asks again from its own time', async () => {
    // 06:07 has the regular 13:30; for 07:07 that has left, and asking again finds only the
    // reservation train.
    const trains = [out('06:07', '11:00'), out('07:07', '12:00'), back('13:30', '18:30'), pe];
    const t = stay({ departAt: '06:00' });
    const r = await plan(t, { ...deps(trains).deps, reservations: 'never' });
    expect(r.options!.map((c) => c.dep)).toEqual([trains[0]!.dep]);
  });

  it('only avoid falls back on reservation trains when regular ones are too late', async () => {
    const t = stay({ arriveBy: '20:00' });
    expect(backOf(await plan(t, deps(list).deps))).toBe(pe.dep);
    const never = await plan(t, { ...deps(list).deps, reservations: 'never' });
    expect(never.options).toBeUndefined();
  });
});

describe('a route that collapses to one stop', () => {
  it('plans nothing instead of failing', async () => {
    const t = tour('Zürich HB', (x) => addWaypoint(x, stop('Zürich HB')));
    const r = await plan(t, deps([]).deps);
    expect(r.options).toBeUndefined();
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
    for (const c of r.options!) expect(c.connections[0]!.sections[0]!.category).toBe('R');
  });
});

describe('a station closed that day', () => {
  // Mürren → Grütschalp (closed) → Lauterbrunnen → Interlaken Ost → Bern → Zürich HB.
  const out = (x: Tour) =>
    addWaypoint(
      addWaypoint(
        addWaypoint(
          addWaypoint(addWaypoint(x, stop('Grütschalp')), stop('Lauterbrunnen')),
          stop('Interlaken Ost'),
        ),
        stop('Bern'),
      ),
      stop('Zürich HB'),
    );
  const hop = (a: string, b: string, dep: string, arr: string) =>
    conn(
      ride('R 1', [
        [a, dep],
        [b, arr],
      ]),
    );
  /** What OJP answers without Grütschalp: straight to Zürich, past none of the stations. */
  const roundabout = conn(
    ride('B 1', [
      ['Mürren BLM', '09:00'],
      ['Spiez', '10:00'],
    ]),
    ride('IC 1', [
      ['Spiez', '10:05'],
      ['Zürich HB', '11:30'],
    ]),
  );

  it('costs only that station: the others are still ridden through', async () => {
    const t = tour('Mürren BLM', out, '09:00');
    const r = await plan(
      t,
      deps([
        roundabout,
        // Station to station, each one there …
        hop('Mürren BLM', 'Lauterbrunnen', '09:00', '09:50'),
        hop('Lauterbrunnen', 'Interlaken Ost', '09:55', '10:15'),
        hop('Interlaken Ost', 'Bern', '10:25', '11:20'),
        // … and the two halves OJP gives when asked with one via each.
        conn(
          ride('R 2', [
            ['Mürren BLM', '09:00'],
            ['Lauterbrunnen', '09:50'],
            ['Interlaken Ost', '10:15'],
          ]),
        ),
        conn(
          ride('IC 2', [
            ['Interlaken Ost', '10:25'],
            ['Bern', '11:20'],
            ['Zürich HB', '12:30'],
          ]),
        ),
      ]).deps,
    );
    expect(r.relaxed).toEqual([{ legIndex: 0, rule: 'mustPass' }]);
    const at = visited(r.recommended!.connections[0]!);
    for (const s of ['Lauterbrunnen', 'Interlaken Ost', 'Bern'])
      expect(at.has(stopKey(ref(s))), s).toBe(true);
    expect(at.has(stopKey(ref('Grütschalp')))).toBe(false);
  });

  it('gives up on the stations only when nothing else connects', async () => {
    const r = await plan(tour('Mürren BLM', out, '09:00'), deps([roundabout]).deps);
    expect(r.relaxed).toEqual([{ legIndex: 0, rule: 'mustPass' }]);
    expect(r.recommended!.connections[0]!.dep).toBe(roundabout.dep);
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
    // The GA note is for a GA or a day pass (the app's ticket), neutral; without either there
    // is no cover to speak of (round 3, R3-9: `ticket: none` was told "not covered by GA").
    const notes = async (ticket: Parameters<typeof plan>[0]['ticket']) =>
      (await plan({ ...t, ticket }, deps([c]).deps)).recommended!.warnings.filter(
        (w) => w.key === 'wGaHalf',
      );
    for (const ticket of ['GA', 'Tageskarte'] as const)
      expect((await notes(ticket)).map((w) => w.severity)).toEqual(['info']);
    for (const ticket of ['Halbtax', 'none'] as const) expect(await notes(ticket)).toEqual([]);
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
    const late = r.options!.at(-1)!.warnings.filter((w) => w.type === 'after-sunset');
    expect(late.map((w) => w.params.highlight)).toContain('landwasser');
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
