// The MCP's plan_trip after the reports of Nov 2026, and its map and abroad tools (split from
// mcp.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoute, routeLinkOf } from '../mcp/src/route';
import { createTools, type ToolDeps } from '../mcp/src/tools';
import { createWorker } from '../mcp/src/worker';
import { gunzipSync } from 'node:zlib';
import { FIXTURE_DATE, ojpFor } from './acceptance/ojp';
import { conn, DATE, index, ride, templates, timetable } from './helpers/timetable';
import { deps, NOW, T5, URL_ } from './helpers/mcp';

describe('plan_trip after the second report', () => {
  type Planned = {
    options: {
      recommended?: boolean;
      departure: string;
      warnings: { type: string; validUntil?: string; detail?: string }[];
    }[];
    reason?: string;
  };
  const B1R = {
    date: '2026-11-06',
    departAt: '08:00',
    stops: [{ name: 'Chur' }, { line: 'albula' }],
  };
  const b1 = (over: Partial<ToolDeps> = {}) =>
    createTools(
      deps({
        now: () => Date.parse('2026-11-05T08:00:00Z'),
        timetable: { ...deps().timetable, trips: ojpFor('B1R').fetchTrips },
        ...over,
      }),
    );

  it('the Albula asked for rides its replacement bus, said so, the notice with its end', async () => {
    const r = (await b1().planTrip(B1R)) as Planned;
    const best = r.options.find((o) => o.recommended)!;
    const types = best.warnings.map((w) => w.type);
    expect(types).toContain('replacement-bus');
    expect(types).not.toContain('line-missed');
    const notice = r.options
      .flatMap((o) => o.warnings)
      .find((w) => w.validUntil === '2026-11-13T23:30');
    expect(notice?.detail).toMatch(/Ersatzbusse/);
  });

  it('strict: a line that cannot be ridden answers no options and why', async () => {
    // Only the Vereina answers: the Albula cannot be ridden at all.
    const vereinaOnly = async (q: Parameters<ReturnType<typeof ojpFor>['fetchTrips']>[0]) =>
      q.vias.length || q.origin.name !== 'Chur' || q.destination.name !== 'St. Moritz'
        ? []
        : (await ojpFor('B1R').fetchTrips(q)).filter((c) =>
            c.sections.some((s) => s.to.name === 'Klosters Platz'),
          );
    const tools = b1({ timetable: { ...deps().timetable, trips: vereinaOnly } });
    const loose = (await tools.planTrip(B1R)) as Planned;
    expect(loose.options.length).toBeGreaterThan(0);
    expect(loose.options.flatMap((o) => o.warnings).map((w) => w.type)).toContain('line-missed');
    const strict = (await tools.planTrip({ ...B1R, strict: true })) as Planned;
    expect(strict).toMatchObject({ status: 'line_not_ridden', options: [] });
    expect(strict.reason).toMatch(/Albula/);
  });

  it('pick: earliest gives the first option after departAt, not the recommended', async () => {
    // 09:05 with two changes, 09:35 straight there: the later one is recommended.
    const early = conn(
      ride('R 61', [
        ['Interlaken Ost', '09:05'],
        ['Wilderswil', '09:10'],
      ]),
      ride('R 61', [
        ['Wilderswil', '09:15'],
        ['Lauterbrunnen', '09:30'],
      ]),
      ride('CC 1', [
        ['Lauterbrunnen', '09:40'],
        ['Kleine Scheidegg', '10:30'],
      ]),
    );
    const late = conn(
      ride('R 61', [
        ['Interlaken Ost', '09:35'],
        ['Kleine Scheidegg', '10:31'],
      ]),
    );
    const tools = createTools(
      deps({
        timetable: { ...deps().timetable, trips: async () => [early, late] },
      }),
    );
    const all = (await tools.planTrip(T5)) as Planned;
    expect(all.options.find((o) => o.recommended)!.departure).toBe(`${FIXTURE_DATE}T09:35`);
    const one = (await tools.planTrip({ ...T5, options: 1, pick: 'earliest' })) as Planned;
    expect(one.options.map((o) => o.departure)).toEqual([`${FIXTURE_DATE}T09:05`]);
    const rec = (await tools.planTrip({ ...T5, options: 1 })) as Planned;
    expect(rec.options.map((o) => o.departure)).toEqual([`${FIXTURE_DATE}T09:35`]);
  });
});

describe('plan_trip: daylight, a time to leave by, the fastest way back (5 Nov 2026)', () => {
  type Planned = {
    status?: string;
    reason?: string;
    options: { departure: string; warnings: { type: string }[] }[];
  };
  const route = (input: Parameters<typeof buildRoute>[0]) =>
    buildRoute(input, { index, templates, now: NOW });
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
  const ALBULA = {
    date: FIXTURE_DATE,
    departAt: '12:00',
    stops: [{ name: 'Chur' }, { line: 'albula' }],
  };
  const tools = (list: ReturnType<typeof conn>[]) =>
    createTools(deps({ timetable: { ...deps().timetable, trips: async () => list } }));
  const day = albulaRide('12:58', '14:00', '15:00');
  const late = albulaRide('15:58', '17:00', '18:00');

  it('daylight: an option riding the line after dark is said; required leaves it out', async () => {
    const said = (await tools([day, late]).planTrip(ALBULA)) as Planned;
    const after = said.options.find((o) => o.departure === `${FIXTURE_DATE}T15:58`)!;
    expect(after.warnings.map((w) => w.type)).toContain('line-after-dark');
    const req = (await tools([day, late]).planTrip({
      ...ALBULA,
      daylight: 'required',
    })) as Planned;
    expect(req.options.map((o) => o.departure)).toEqual([`${FIXTURE_DATE}T12:58`]);
    const none = (await tools([late]).planTrip({ ...ALBULA, daylight: 'required' })) as Planned;
    expect(none).toMatchObject({ status: 'after_dark', options: [] });
    expect(none.reason).toMatch(/Albula/);
  });

  it('a stop’s time to leave by and to arrive after, kept in the route and its link', () => {
    const t = route({
      date: FIXTURE_DATE,
      stops: [
        { name: 'Zürich HB' },
        { name: 'Melide', stay: 150, arriveAfter: '09:00', leaveBy: '17:30' },
        { name: 'Lugano' },
      ],
    });
    expect(t.waypoints[1]).toMatchObject({ leaveBy: '17:30', arriveAfter: '09:00' });
    expect(routeLinkOf(t, URL_)).toContain('.f0900.u1730');
    expect(() =>
      route({ stops: [{ name: 'Zürich HB' }, { name: 'Melide', leaveBy: '5pm' }] }),
    ).toThrow(/not a time/);
  });

  it('a stay until a time, kept in the route and its link; a later day refused (0.64.0)', () => {
    const next = new Date(Date.parse(`${FIXTURE_DATE}T12:00:00Z`) + 86400_000)
      .toISOString()
      .slice(0, 10);
    const stops = (stayUntil: string) => [
      { name: 'Zürich HB' },
      { name: 'Lugano', stayUntil },
      { name: 'Bern' },
    ];
    const t = route({ date: FIXTURE_DATE, stops: stops(`${FIXTURE_DATE}T15:15`) });
    expect(t.waypoints[1]).toMatchObject({
      kind: 'stop',
      dwellMin: 30,
      stayUntil: `${FIXTURE_DATE}T15:15`,
    });
    expect(routeLinkOf(t, URL_)).toContain(`.n${FIXTURE_DATE.replace(/-/g, '')}1515`);
    // A night there: one trip per day of travel.
    expect(() => route({ date: FIXTURE_DATE, stops: stops(`${next}T09:15`) })).toThrow(
      /overnight_stay/,
    );
    expect(() => route({ date: FIXTURE_DATE, stops: stops('tomorrow') })).toThrow(/not a date/);
    expect(() => route({ date: FIXTURE_DATE, stops: stops('2020-01-01T09:00') })).toThrow(
      /before the trip/,
    );
  });

  it('returnWay fastest: after the last stay, straight home', () => {
    const stops = [
      { name: 'Zürich HB' },
      { line: 'voralpen-express' },
      { name: 'Luzern', stay: 60 },
      { name: 'Bern' },
      { name: 'Olten' },
    ];
    const listed = route({ date: FIXTURE_DATE, stops, roundTrip: true });
    expect(listed.waypoints.map((w) => w.name).slice(-3)).toEqual(['Bern', 'Olten', 'Zürich HB']);
    const fast = route({ date: FIXTURE_DATE, stops, roundTrip: true, returnWay: 'fastest' });
    expect(fast.waypoints.map((w) => w.name).slice(-2)).toEqual(['Luzern', 'Zürich HB']);
    // The way out keeps its line.
    expect(fast.waypoints.some((w) => w.name === 'St. Gallen')).toBe(true);
    expect(() => route({ date: FIXTURE_DATE, stops, returnWay: 'fastest' })).toThrow(/roundTrip/);
    expect(() =>
      route({
        date: FIXTURE_DATE,
        stops: [{ name: 'Zürich HB' }, { name: 'Luzern' }],
        roundTrip: true,
        returnWay: 'fastest',
      }),
    ).toThrow(/stay/);
  });

  // Round 3 (R3-16, M3): as_listed came back the fastest way; same_way rides the way out back.
  it('returnWay same_way: the way out reversed, its line included, without its stays', () => {
    const stops = [
      { name: 'Zürich HB' },
      { line: 'gotthard-bergstrecke' },
      { name: 'Lugano', stay: 60 },
    ];
    const t = route({ date: FIXTURE_DATE, stops, roundTrip: true, returnWay: 'same_way' });
    const names = t.waypoints.map((w) => w.name);
    expect(names[0]).toBe('Zürich HB');
    expect(names.at(-1)).toBe('Zürich HB');
    const turn = names.indexOf('Lugano');
    // Göschenen and Airolo out, and back again in the other order.
    expect(names.slice(0, turn)).toEqual(expect.arrayContaining(['Göschenen', 'Airolo']));
    const back = names.slice(turn + 1);
    expect(back.indexOf('Airolo')).toBeGreaterThanOrEqual(0);
    expect(back.indexOf('Airolo')).toBeLessThan(back.indexOf('Göschenen'));
    // Only the stay at Lugano.
    expect(t.waypoints.filter((w) => w.kind === 'stop').map((w) => w.name)).toEqual(['Lugano']);
    expect(() => route({ date: FIXTURE_DATE, stops, returnWay: 'same_way' })).toThrow(/roundTrip/);
  });
});

// Round 3 (M1, R3-9): a reservation-only train says so on its ride; without a pass, no cover notes.
describe('plan_trip: reservations and cover by ticket (round 3)', () => {
  const bex = conn(
    ride(
      'PE 951',
      [
        ['St. Moritz', '09:00'],
        ['Tirano', '11:30'],
      ],
      { product: 'BERNINA EXPRESS' },
    ),
  );
  const tools = (list = [bex]) =>
    createTools(deps({ timetable: { ...deps().timetable, trips: timetable(list).fetchTrips } }));
  const ask = (ticket?: 'GA' | 'none' | 'Halbtax') =>
    tools().planTrip({
      date: DATE,
      departAt: '08:30',
      stops: [{ name: 'St. Moritz' }, { name: 'Tirano' }],
      reservations: 'include',
      ...(ticket ? { ticket } : {}),
    }) as Promise<{
      options: { legs: { reservationRequired?: boolean }[]; warnings: { type: string }[] }[];
    }>;

  it('marks the reservation-only ride', async () => {
    const r = await ask();
    expect(r.options[0]!.legs[0]!.reservationRequired).toBe(true);
  });

  it('says GA cover with a GA, nothing with none or Halbtax', async () => {
    // Past the border the GA ends: Le Châtelard-Frontière → Vallorcine.
    const across = conn(
      ride('R 85', [
        ['Le Châtelard-Frontière', '09:59'],
        ['Vallorcine', '10:05'],
      ]),
    );
    const types = async (ticket?: 'GA' | 'none' | 'Halbtax') =>
      (
        (await tools([across]).planTrip({
          date: DATE,
          departAt: '09:30',
          stops: [{ name: 'Le Châtelard-Frontière' }, { name: 'Vallorcine' }],
          ...(ticket ? { ticket } : {}),
        })) as { options: { warnings: { type: string }[] }[] }
      ).options[0]!.warnings.map((w) => w.type);
    expect(await types('GA')).toContain('not-ga');
    for (const t of ['none', 'Halbtax'] as const) expect(await types(t)).not.toContain('not-ga');
  });
});

describe('the map planner’s tools (0.28.0)', () => {
  const tools = createTools(deps());

  it('reachable_from: where the trains from a stop go without a change, and an estimate', async () => {
    const r = (await tools.reachableFrom({
      stop: { name: 'Interlaken Ost' },
      date: FIXTURE_DATE,
      time: '09:00',
      estimateFor: ['Grindelwald', 'Zermatt', 'Xqzzz'],
    })) as {
      reached: { name: string; arrival: string; train?: string }[];
      estimates: Record<string, unknown>[];
    };
    const names = r.reached.map((x) => x.name);
    for (const n of ['Grindelwald', 'Lauterbrunnen', 'Meiringen', 'Luzern'])
      expect(names).toContain(n);
    expect(r.reached.find((x) => x.name === 'Luzern')!.train).toContain('LIX');
    expect(r.estimates[0]).toMatchObject({ name: 'Grindelwald', direct: true });
    expect(r.estimates[1]).toMatchObject({ name: 'Zermatt' });
    expect(r.estimates[1]!.aboutMinutes).toBeGreaterThan(60);
    expect(r.estimates[2]).toMatchObject({ unknown: true });
  });

  it('find_stops near a point: the station first, bus stops close by only when asked', async () => {
    const at = { lat: 46.6243, lon: 8.0336, km: 5 };
    const trains = await tools.findStops({ near: at });
    expect(trains.stops[0]!.name).toBe('Grindelwald');
    expect(trains.stops.every((s) => s.kind !== 'bus')).toBe(true);
    const all = await tools.findStops({ near: { ...at, buses: true } });
    expect(all.stops.some((s) => s.kind === 'bus')).toBe(true);
    await expect(tools.findStops({})).rejects.toThrow('give query');
  });

  it('plan_trip says whose each station is: yours, the plan’s', async () => {
    const r = (await tools.planTrip(T5)) as {
      options: { legs: { type: string; from?: { source: string }; to?: { source: string } }[] }[];
    };
    const rides = r.options[0]!.legs.filter((l) => l.type === 'ride');
    expect(rides[0]!.from!.source).toBe('yours');
    expect(rides.at(-1)!.to!.source).toBe('yours');
    if (rides.length > 1) expect(rides[0]!.to!.source).toBe('plan');
  });
});

describe('abroad (0.35.0): stations and legs through Transitous, as the app plans them', () => {
  const eu = (name: string) =>
    gunzipSync(readFileSync(`tests/fixtures/eu/${name}.json.gz`)).toString('utf8');
  // The Worker as the MCP asks it: its stations answer (already Transitous' railway stations)
  // and its plan (Transitous' own); nothing else is asked.
  const asked: string[] = [];
  const worker = createWorker({
    url: 'https://w.example',
    index,
    budget: { take: async () => {} } as never,
    fetch: (async (url: string) => {
      asked.push(new URL(url).pathname);
      if (url.endsWith('/eu/stops'))
        return new Response(
          JSON.stringify([
            {
              id: 'de-DELFI_de:09162:100',
              name: 'München Hbf',
              lat: 48.14016,
              lon: 11.5539,
              country: 'DE',
            },
          ]),
        );
      if (url.endsWith('/eu/plan')) return new Response(eu('muenchen'));
      return new Response('', { status: 500 });
    }) as never,
  });
  const tools = createTools(
    deps({ timetable: { ...deps().timetable, ...worker, trips: worker.trips } }),
  );

  it('find_stops with abroad: stations abroad, each a ref to give plan_trip with its name', async () => {
    const r = await tools.findStops({ query: 'München', abroad: true });
    expect(r.abroad).toEqual([
      expect.objectContaining({
        name: 'München Hbf',
        country: 'DE',
        ref: expect.stringMatching(/^eu:48\.14016,11\.5539/),
      }),
    ]);
    // Without abroad, nothing is asked of Transitous.
    asked.length = 0;
    expect((await tools.findStops({ query: 'Bern' })).abroad).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('plan_trip to a station abroad: Transitous’ train, the GA ending at the border', async () => {
    const [m] = (await tools.findStops({ query: 'München', abroad: true })).abroad!;
    const r = (await tools.planTrip({
      date: FIXTURE_DATE,
      departAt: '08:00',
      stops: [{ name: 'Zürich HB' }, { ref: m!.ref, name: m!.name }],
    })) as {
      options: {
        recommended?: boolean;
        legs: { type: string; from: { name: string }; to: { name: string } }[];
        warnings: { type: string }[];
      }[];
    };
    const best = r.options.find((o) => o.recommended)!;
    const rides = best.legs.filter((l) => l.type === 'ride');
    expect(rides[0]!.from.name).toBe('Zürich HB');
    expect(rides.at(-1)!.to.name).toBe('München Hbf');
    expect(best.warnings.map((w) => w.type)).toContain('not-ga');
    await expect(
      tools.planTrip({
        date: FIXTURE_DATE,
        departAt: '08:00',
        stops: [{ name: 'Zürich HB' }, { ref: m!.ref }],
      }),
    ).rejects.toThrow('needs its name too');
  });
});
