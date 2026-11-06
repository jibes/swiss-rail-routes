// The MCP server (mcp/): tools on recorded OJP answers, and the real SDK client over real HTTP.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRoute, routeLinkOf, resolveWhen } from '../mcp/src/route';
import { checkWith } from '../mcp/src/keys';
import { createHttpServer } from '../mcp/src/server';
import { createTools, type ToolDeps } from '../mcp/src/tools';
import {
  BusyError,
  CallBudget,
  createWorker,
  UnavailableError,
  withoutTracks,
} from '../mcp/src/worker';
import { decodeTripLink } from '../src/core/export/tripLink';
import { parseRoute } from '../src/core/export/routeLink';
import { parseJourney } from '../src/core/ojp/journey';
import { stopKey } from '../src/core/stops';
import { isPlanned, type PlannedTrip } from '../src/core/trip';
import { FIXTURE_DATE, ojpFor } from './acceptance/ojp';
import { conn, DATE, ga, index, ride, templates, timetable } from './helpers/timetable';

const NOW = Date.parse('2026-11-02T08:00:00Z');
const URL_ = 'https://viadukt.example/';
const T5 = {
  date: FIXTURE_DATE,
  departAt: '09:00',
  stops: [{ name: 'Interlaken Ost' }, { name: 'Kleine Scheidegg' }],
};

const deps = (over: Partial<ToolDeps> = {}): ToolDeps => ({
  index,
  timetable: {
    trips: ojpFor('T5').fetchTrips,
    journey: async () =>
      parseJourney(readFileSync('tests/fixtures/ojp/tripinfo/running.xml', 'utf8')),
  },
  templates,
  ga,
  publicUrl: URL_,
  now: () => NOW,
  ...over,
});
const nameOf = (r: string) => index.byRef(stopKey(r))?.name;

describe('routes from a request', () => {
  const route = (input: Parameters<typeof buildRoute>[0]) =>
    buildRoute(input, { index, templates, now: NOW });

  // Retest round 3, 6 Nov 2026: Zürich HB → Zürich HB said "needs at least two stations".
  it('the same station twice in a row is said as such', () => {
    expect(() => route({ stops: [{ name: 'Zürich HB' }, { name: 'Zürich HB' }] })).toThrow(
      'Start and end are the same station: use roundTrip',
    );
    expect(() => route({ stops: [{ name: 'Bern' }, { name: 'Thun' }, { name: 'Thun' }] })).toThrow(
      'Thun is listed twice in a row',
    );
    // A line ending at the station listed next is that end, not a repeat.
    expect(() =>
      route({
        date: FIXTURE_DATE,
        stops: [{ name: 'Chur' }, { line: 'albula' }, { name: 'St. Moritz' }],
      }),
    ).not.toThrow();
  });

  it('the request in the spec: a line, 2 h at its end, home by 21:00', () => {
    const t = route({
      date: FIXTURE_DATE,
      arriveBy: '21:00',
      stops: [{ name: 'Zürich HB' }, { line: 'bernina' }, { name: 'Tirano', stay: 120 }],
      roundTrip: true,
    });
    expect(t.anchor).toEqual({ arriveBy: '21:00' });
    expect(t.waypoints.map((w) => w.name)).toEqual([
      'Zürich HB',
      'St. Moritz',
      'Pontresina',
      'Ospizio Bernina',
      'Alp Grüm',
      'Tirano',
      'Zürich HB',
    ]);
    const tirano = t.waypoints[5]!;
    expect([tirano.kind, tirano.dwellMin, tirano.line]).toEqual(['stop', 120, 'bernina']);
    expect(t.waypoints.at(-1)!.kind).toBe('end');
    expect(t.ticket).toBe('GA');
  });

  it('a line runs the way that continues the route', () => {
    const back = route({
      date: FIXTURE_DATE,
      stops: [{ name: 'Tirano' }, { line: 'bernina' }, { name: 'Chur' }],
    });
    expect(back.waypoints.map((w) => w.name).slice(0, 3)).toEqual([
      'Tirano',
      'Alp Grüm',
      'Ospizio Bernina',
    ]);
    const towards = route({
      date: FIXTURE_DATE,
      stops: [{ line: 'bernina' }, { name: 'Chur' }],
    });
    expect(towards.waypoints[0]!.name).toBe('Tirano');
  });

  it('a line whose end is the next station leads there (reported 4 Nov 2026)', () => {
    // Zürich, Voralpen-Express, Luzern: St. Gallen → Luzern, not Luzern → St. Gallen and back.
    const t = route({
      date: FIXTURE_DATE,
      stops: [
        { name: 'Zürich HB' },
        { line: 'voralpen-express' },
        { name: 'Luzern', stay: 45 },
        { line: 'bruenig' },
        { name: 'Interlaken Ost' },
      ],
      roundTrip: true,
    });
    const names = t.waypoints.map((w) => w.name);
    expect(names.slice(0, 2)).toEqual(['Zürich HB', 'St. Gallen']);
    expect(names.filter((n) => n === 'Luzern')).toHaveLength(1);
    expect(names.filter((n) => n === 'St. Gallen')).toHaveLength(1);
    // The line is marked on the end it leads to, Luzern, with its stay.
    const luzern = t.waypoints.find((w) => w.name === 'Luzern')!;
    expect(luzern).toMatchObject({ kind: 'stop', dwellMin: 45, line: 'voralpen-express' });
    expect(routeLinkOf(t, URL_)).toContain('luzern.5000.45.@voralpen-express');
  });

  it('out and back without a round trip: stations, part of a line by its own', () => {
    // St. Moritz → Alp Grüm (stay) → St. Moritz: the Bernina line part way, as plan_trip says.
    const t = route({
      date: FIXTURE_DATE,
      stops: [{ name: 'St. Moritz' }, { name: 'Alp Grüm', stay: 60 }, { name: 'St. Moritz' }],
    });
    expect(t.waypoints.map((w) => [w.name, w.kind, w.dwellMin])).toEqual([
      ['St. Moritz', 'start', 0],
      ['Alp Grüm', 'stop', 60],
      ['St. Moritz', 'end', 0],
    ]);
  });

  it('stay 0 or none rides through; a stay at the very start or end is refused (round 3)', () => {
    const t = route({
      date: FIXTURE_DATE,
      stops: [
        { name: 'Bern' },
        { name: 'Thun', stay: 0 },
        { name: 'Spiez', stay: 45 },
        { name: 'Brig' },
      ],
    });
    expect(t.waypoints.map((w) => [w.kind, w.dwellMin])).toEqual([
      ['start', 0],
      ['via', 0],
      ['stop', 45],
      ['end', 0],
    ]);
    // Round 3 (R3-15): left out without a word before.
    for (const stops of [
      [{ name: 'Bern', stay: 60 }, { name: 'Luzern' }],
      [{ name: 'Bern' }, { name: 'Luzern', stay: 30 }],
    ])
      expect(() => route({ date: FIXTURE_DATE, stops })).toThrow(
        'A stay at the start or the end has no effect',
      );
    // A round trip's last listed station is its turn: a stay there is a stay.
    expect(
      route({
        date: FIXTURE_DATE,
        stops: [{ name: 'Bern' }, { name: 'Luzern', stay: 30 }],
        roundTrip: true,
      }).waypoints.map((w) => w.dwellMin),
    ).toEqual([0, 30, 0]);
  });

  it('refuses what cannot be planned, before anything is asked of OJP', () => {
    expect(() =>
      route({ date: FIXTURE_DATE, stops: [{ name: 'Xqzzz' }, { name: 'Bern' }] }),
    ).toThrow('unknown stop');
    expect(() =>
      route({ date: FIXTURE_DATE, stops: [{ ref: 'ch:1:sloid:99999999' }, { name: 'Bern' }] }),
    ).toThrow('unknown stop');
    expect(() => route({ date: FIXTURE_DATE, stops: [{}, { name: 'Bern' }] })).toThrow(
      'unknown stop',
    );
    expect(() =>
      route({ date: FIXTURE_DATE, stops: [{ name: 'Bern' }, { line: 'nope' }] }),
    ).toThrow('unknown scenic line');
    expect(() => route({ date: FIXTURE_DATE, stops: [{ name: 'Bern' }] })).toThrow('at least two');
    expect(() => route({ date: FIXTURE_DATE, stops: Array(13).fill({ name: 'Bern' }) })).toThrow(
      'at most 12',
    );
  });

  it('times: never before now today, sensible dates only', () => {
    const when = (x: Parameters<typeof resolveWhen>[0]) => resolveWhen(x, NOW);
    expect(when({})).toEqual({ date: '2026-11-02', anchor: { departAt: '09:05' } });
    expect(when({ departAt: '06:00' }).anchor).toEqual({ departAt: '09:05' });
    expect(when({ departAt: '18:00' }).anchor).toEqual({ departAt: '18:00' });
    expect(when({ date: FIXTURE_DATE }).anchor).toEqual({ departAt: '08:00' });
    expect(when({ date: FIXTURE_DATE, departAt: '06:00' }).anchor).toEqual({ departAt: '06:00' });
    expect(() => when({ arriveBy: '08:00' })).toThrow('has passed');
    expect(() => when({ departAt: '09:00', arriveBy: '10:00' })).toThrow('not both');
    expect(() => when({ date: '2026-11-01' })).toThrow('has passed');
    expect(() => when({ date: '2030-01-01' })).toThrow('too far');
    expect(() => when({ date: 'tomorrow' })).toThrow('not a date');
    expect(() => when({ departAt: '25:00' })).toThrow('not a time');
  });

  it('a route link the app reads back as the same route', () => {
    const t = route({
      date: FIXTURE_DATE,
      arriveBy: '21:00',
      stops: [{ name: 'Zürich HB' }, { line: 'bernina' }, { name: 'Tirano', stay: 120 }],
      roundTrip: true,
    });
    const link = routeLinkOf(t, URL_);
    const [stops, q] = link.split('#/r/')[1]!.split('?');
    const back = parseRoute(stops!, new URLSearchParams(q), {
      templates,
      name: nameOf,
      today: '2026-11-02',
    })!;
    expect(back.waypoints.map((w) => [w.stopRef, w.kind, w.dwellMin])).toEqual(
      t.waypoints.map((w) => [w.stopRef, w.kind, w.dwellMin]),
    );
    expect(back.anchor).toEqual({ arriveBy: '21:00' });
    expect(back.date).toBe(FIXTURE_DATE);
  });
});

describe('tools, on recorded answers', () => {
  it('find_stops and list_scenic_lines', () => {
    const tools = createTools(deps());
    const stops = tools.findStops({ query: 'Kleine Sch' }).stops;
    expect(stops[0]).toMatchObject({ name: 'Kleine Scheidegg', kind: 'train' });
    expect(stops[0]!.ref).toMatch(/^ch:1:sloid:\d+$/);
    expect(tools.findStops({ query: 'Bern', limit: 2 }).stops).toHaveLength(2);
    // Reported 5 Nov 2026: "Swissminiatur" found only its pier, not Melide's station.
    const mini = tools.findStops({ query: 'Swissminiatur' });
    expect(mini.places?.[0]?.stops[0]).toMatchObject({ name: 'Melide' });
    expect(mini.places?.[0]?.walkIsEstimate).toBe(true);
    expect(tools.findStops({ query: 'Rheinfall', lang: 'fr' }).places?.[0]?.name).toBe(
      'Chutes du Rhin',
    );
    const all = tools.listScenicLines({}).lines;
    expect(all.length).toBe(templates.length);
    const b = tools.listScenicLines({ query: 'bernina' }).lines.find((l) => l.id === 'bernina')!;
    expect(b).toMatchObject({ from: 'St. Moritz', to: 'Tirano', reservation: true });
    // Reported 4 Nov 2026: "reservation" read as "the line needs one"; it means some trains do.
    expect(b).toMatchObject({
      reservationOnlyTrains: true,
      reservationNote: expect.stringMatching(/Regular trains run here too/),
    });
    expect(b.mustPass).toEqual(['Pontresina', 'Ospizio Bernina', 'Alp Grüm']);
    expect(tools.listScenicLines({ query: 'Tirano' }).lines.map((l) => l.id)).toContain('bernina');
    expect(all.find((l) => l.id === 'lake-lucerne')!.modes).toContain('boat');
    // Round 3 (R3-14): modes said as what they are, the lake's name translated, named trains found.
    expect(all.find((l) => l.id === 'lake-lucerne')!.allowedModes).toEqual(['boat']);
    expect(
      tools.listScenicLines({ lang: 'it' }).lines.find((l) => l.id === 'lake-lucerne')!.name,
    ).toBe('Lago dei Quattro Cantoni (battello)');
    const glacier = tools.listScenicLines({ query: 'Glacier Express' });
    expect(glacier.lines.map((l) => l.id).sort()).toEqual(['albula', 'oberalp']);
    expect(glacier.products).toEqual([
      expect.objectContaining({ name: 'Glacier Express', lines: ['albula', 'oberalp'] }),
    ]);
    expect(glacier.products![0]!.note).toMatch(/may run on more/);
    expect(tools.listScenicLines({ query: 'GoldenPass' }).lines.map((l) => l.id)).toContain(
      'goldenpass-mob',
    );
  });

  it('plan_trip: the app’s plan, GA warning, walks and rides, links that open it', async () => {
    const r = (await createTools(deps()).planTrip(T5)) as Exclude<
      Awaited<ReturnType<ReturnType<typeof createTools>['planTrip']>>,
      { status: string }
    >;
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options.length).toBeLessThanOrEqual(3);
    expect(r.options.filter((o) => o.recommended)).toHaveLength(1);
    const best = r.options.find((o) => o.recommended)!;
    expect(best.departure).toMatch(/^2026-11-07T\d\d:\d\d$/);
    expect(best.durationMin).toBeGreaterThan(0);
    const ride = best.legs.find((l) => l.type === 'ride')!;
    expect(ride).toMatchObject({ type: 'ride' });
    if (ride.type === 'ride') {
      expect(ride.journey).toMatch(/^2026-11-07:/);
      expect(ride.from.dep).toMatch(/T\d\d:\d\d$/);
      expect(ride.line).toBeTruthy();
    }
    expect(r.options.flatMap((o) => o.warnings).some((w) => w.type === 'not-ga')).toBe(true);
    expect(r.options.flatMap((o) => o.warnings).every((w) => !w.text.includes('{'))).toBe(true);
    expect(best.notReached).toEqual([]);

    // The link opens as this very option in the app, and is short enough for any messenger.
    expect(r.link.length).toBeLessThan(1000);
    expect(r.link.startsWith(`${URL_}#/s/`)).toBe(true);
    const back = await decodeTripLink(r.link.slice(URL_.length), 'x', nameOf);
    expect(back && isPlanned(back)).toBe(true);
    const rides = (back as PlannedTrip).chain.connections
      .flatMap((c) => c.sections)
      .filter((s) => s.mode !== 'walk');
    expect(rides.map((s) => s.journey)).toEqual(
      best.legs.flatMap((l) => (l.type === 'ride' ? [l.journey] : [])),
    );
    expect(r.routeLink).toContain('#/r/interlaken-ost.');
  });

  it('text comes in the language asked for', async () => {
    const de = (await createTools(deps()).planTrip({ ...T5, lang: 'de' })) as {
      options: { warnings: { type: string; text: string }[] }[];
    };
    const en = (await createTools(deps()).planTrip(T5)) as typeof de;
    const notGa = (x: typeof de) =>
      x.options.flatMap((o) => o.warnings).find((w) => w.type === 'not-ga')!.text;
    expect(notGa(de)).not.toBe(notGa(en));
  });

  it('options: as many as asked for, the recommended always among them', async () => {
    const r = (await createTools(deps()).planTrip({ ...T5, options: 1 })) as {
      options: { recommended?: boolean }[];
    };
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.recommended).toBe(true);
  });

  it('what has left since it was planned is no longer offered', async () => {
    let t = Date.parse(`${FIXTURE_DATE}T07:52:00Z`);
    const tools = createTools(deps({ now: () => t }));
    const first = (await tools.planTrip(T5)) as { options: { departure: string }[] };
    t = Date.parse(`${first.options[0]!.departure}:00+01:00`) + 60_000;
    const later = (await tools.planTrip(T5)) as { options: { departure: string }[] };
    expect(later.options.map((o) => o.departure)).not.toContain(first.options[0]!.departure);
  });

  it('no connection: says which leg; the service down: says that, and tries again next time', async () => {
    const none = createTools(deps({ timetable: { ...deps().timetable, trips: async () => [] } }));
    await expect(none.planTrip(T5)).rejects.toThrow(
      'no connection on leg 1 (Interlaken Ost → Kleine Scheidegg)',
    );
    let up = false;
    const flaky = createTools(
      deps({
        timetable: {
          ...deps().timetable,
          trips: async (q) => {
            if (!up) throw new UnavailableError();
            return ojpFor('T5').fetchTrips(q);
          },
        },
      }),
    );
    await expect(flaky.planTrip(T5)).rejects.toThrow('timetable service unavailable');
    up = true;
    await expect(flaky.planTrip(T5)).resolves.toMatchObject({ date: FIXTURE_DATE });
  });

  it('a slow plan says "call again"; the same arguments get that plan, with no second one', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const trips = vi.fn(async (q: Parameters<ToolDeps['timetable']['trips']>[0]) => {
      await gate;
      return ojpFor('T5').fetchTrips(q);
    });
    const tools = createTools(deps({ waitMs: 10, timetable: { ...deps().timetable, trips } }));
    expect(await tools.planTrip(T5)).toMatchObject({ status: 'still_planning' });
    expect(await tools.planTrip(T5)).toMatchObject({ status: 'still_planning' });
    const asked = trips.mock.calls.length;
    release();
    await vi.waitFor(async () => {
      const r = await tools.planTrip(T5);
      expect(r).toHaveProperty('options');
    });
    const again = trips.mock.calls.length;
    await tools.planTrip(T5);
    expect(trips.mock.calls.length).toBe(again);
    expect(asked).toBe(1);
  });

  it('too many plans at once are asked to wait', async () => {
    const trips = () => new Promise<never>(() => {});
    const tools = createTools(deps({ waitMs: 1, timetable: { ...deps().timetable, trips } }));
    for (const departAt of ['09:01', '09:02', '09:03', '09:04'])
      await tools.planTrip({ ...T5, departAt });
    await expect(tools.planTrip({ ...T5, departAt: '09:05' })).rejects.toBeInstanceOf(BusyError);
  });

  it('more_options: only the other side of `from`, never gone', async () => {
    const asked: string[] = [];
    const trips = async (q: Parameters<ToolDeps['timetable']['trips']>[0]) => {
      asked.push(q.time);
      return ojpFor('T5').fetchTrips({ ...q, time: `${FIXTURE_DATE}T09:00` });
    };
    const tools = createTools(deps({ timetable: { ...deps().timetable, trips } }));
    const { departAt: _d, ...base } = T5;
    const later = (await tools.moreOptions({ ...base, direction: 'later', from: '09:00' })) as {
      options: { departure: string }[];
    };
    expect(asked[0]).toBe(`${FIXTURE_DATE}T09:01`);
    expect(later.options.length).toBeGreaterThan(0);
    for (const o of later.options) expect(o.departure > `${FIXTURE_DATE}T09:00`).toBe(true);
    asked.length = 0;
    const earlier = (await tools.moreOptions({ ...base, direction: 'earlier', from: '11:30' })) as {
      options: { departure: string }[];
    };
    expect(asked[0]).toBe(`${FIXTURE_DATE}T09:30`);
    for (const o of earlier.options) expect(o.departure < `${FIXTURE_DATE}T11:30`).toBe(true);
    await expect(tools.moreOptions({ ...base, direction: 'later', from: 'soon' })).rejects.toThrow(
      'not a time',
    );
    // Earlier than the first train of the day: said why, not an empty list (round 3, R3-11).
    const none = await tools.moreOptions({ ...base, direction: 'earlier', from: '00:30' });
    expect(none).toMatchObject({ status: 'none_earlier', options: [] });
    expect((none as { message: string }).message).toMatch(/earlier/);
  });

  it('train_status: stops with planned and expected times, delays, and when it was asked', async () => {
    const tools = createTools(deps());
    const r = await tools.trainStatus({ journey: '2026-11-07:ch:1:sjyid:100001:726-001' });
    const stops = r.stops ?? [];
    expect(r.date).toBe('2026-11-07');
    expect(r.journey).toBe('ch:1:sjyid:100001:726-001');
    expect(stops.length).toBeGreaterThan(1);
    expect(stops[0]).toHaveProperty('plannedDep');
    expect(stops.some((s) => s.passed)).toBe(true);
    expect(r.fetchedAt).toBe('2026-11-02T09:00');
    // Round 3 (R3-8): an id without its date says how to give it.
    await expect(tools.trainStatus({ journey: 'ch:1:sjyid:100001:726-001' })).rejects.toThrow(
      'This journey id needs its date',
    );
    await expect(tools.trainStatus({ journey: '<x/>', date: '2026-11-07' })).rejects.toThrow(
      'not a journey id',
    );
  });

  // Round 3 (R3-7): a foreign train from a plan (the TER Vallorcine–Chamonix) was "bad journey".
  it('train_status: a train outside Switzerland from a plan is said to have no live status', async () => {
    let asked = 0;
    const tools = createTools(
      deps({
        timetable: {
          ...deps().timetable,
          journey: async () => {
            asked++;
            throw new Error('not asked');
          },
        },
      }),
    );
    const r = await tools.trainStatus({ journey: '2026-11-07:ojp:91P52:_x0020_:R:j26:95' });
    expect(r).toMatchObject({ status: 'not_available', date: '2026-11-07' });
    expect(asked).toBe(0);
  });

  // Retest round 3, 6 Nov 2026: an unknown journey id was said as the service being down.
  it('train_status: a journey the timetable does not have is said as such, not as an outage', async () => {
    const unknown = readFileSync('tests/fixtures/ojp/tripinfo/unknown.xml', 'utf8');
    const tools = createTools(
      deps({ timetable: { ...deps().timetable, journey: async () => parseJourney(unknown) } }),
    );
    const r = await tools.trainStatus({ journey: '2026-11-07:ch:1:sjyid:100001:99999-001' });
    expect(r).toMatchObject({ status: 'unknown_journey', date: '2026-11-07' });
    // Through the Worker adapter, as the server meets it.
    const worker = createWorker({
      url: 'https://w.example',
      fetch: async () => new Response(unknown, { status: 200 }),
      budget: { take: async () => {} } as never,
    });
    await expect(worker.journey({ journey: 'ch:1:sjyid:1', day: '2026-11-07' })).rejects.toThrow(
      'no such journey',
    );
  });

  it('train_status: a platform changed and an operator’s notice are said', () => {
    const xml = (inner: string, context = '') =>
      `<OJP><OJPResponse><ServiceDelivery><OJPTripInfoDelivery><TripInfoResponseContext>${context}</TripInfoResponseContext><TripInfoResult>${inner}</TripInfoResult></OJPTripInfoDelivery></ServiceDelivery></OJPResponse></OJP>`;
    const s = parseJourney(
      xml(
        '<OnwardCall><StopPointRef>ch:1:sloid:3000</StopPointRef><StopPointName><Text>Zürich HB</Text></StopPointName><PlannedQuay><Text>3</Text></PlannedQuay><EstimatedQuay><Text>7</Text></EstimatedQuay></OnwardCall>',
        '<Situations><PtSituation><PublishingActions><PublishingAction><PassengerInformationAction><TextualContent><SummaryContent><SummaryText>Line closed</SummaryText></SummaryContent></TextualContent></PassengerInformationAction></PublishingAction></PublishingActions></PtSituation></Situations>',
      ),
    );
    expect(s.calls[0]).toMatchObject({ platform: '7', platformPlanned: '3' });
    expect(s.notices).toEqual(['Line closed']);
  });
});

describe('the Worker from Node', () => {
  const q = {
    origin: { ref: 'ch:1:sloid:3000', name: 'Zürich HB' },
    destination: { ref: 'ch:1:sloid:9000', name: 'Chur' },
    vias: [],
    notVias: [],
    time: '2026-11-02T10:00',
    arriveBy: false,
    results: 6,
  };
  const answer =
    '<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery><ErrorCondition><TripProblemType>TRIP_NOTRIPFOUND</TripProblemType></ErrorCondition></OJPTripDelivery></ServiceDelivery></OJPResponse></OJP>';
  const free = () => new CallBudget(1000, 1000);
  const none = async () => undefined;

  it('drops the tracks while reading, wherever the chunks fall', async () => {
    const xml =
      'a<ojp:Leg><LinkProjection><Position>1</Position></LinkProjection>b<x:LinkProjection>2</x:LinkProjection>c<C>é</C>';
    const bytes = new TextEncoder().encode(xml);
    for (const size of [1, 2, 3, 7, 16, bytes.length]) {
      const body = new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
          c.close();
        },
      });
      expect(await withoutTracks(new Response(body))).toBe('a<ojp:Leg>bc<C>é</C>');
    }
  });

  it('keeps answers: 15 minutes on the day, until the day starts for a later one', async () => {
    let t = NOW;
    const fetch = vi.fn(async () => new Response(answer));
    const w = createWorker({
      url: 'https://w.example/',
      fetch: fetch as never,
      now: () => t,
      budget: free(),
    });
    await w.trips(q);
    await w.trips(q);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls as unknown[][])[0]![0])).toBe('https://w.example/trip');
    t += 16 * 60_000;
    await w.trips(q);
    expect(fetch).toHaveBeenCalledTimes(2);
    const later = { ...q, time: '2026-11-07T10:00' };
    await w.trips(later);
    t = Date.parse('2026-11-06T22:00:00Z');
    await w.trips(later);
    expect(fetch).toHaveBeenCalledTimes(3);
    t = Date.parse('2026-11-07T00:01:00Z');
    await w.trips(later);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('the same question at once is asked once', async () => {
    const fetch = vi.fn(async () => new Response(answer));
    const w = createWorker({ url: 'https://w.example', fetch: fetch as never, budget: free() });
    await Promise.all([w.trips(q), w.trips(q), w.trips(q)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a 429 waits as told and tries again; too long a wait is a clear "busy"', async () => {
    const replies = [
      new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      new Response(answer),
    ];
    const sleep = vi.fn(none);
    const w = createWorker({
      url: 'https://w.example',
      fetch: (async () => replies.shift()!) as never,
      budget: free(),
      sleep,
    });
    await expect(w.trips(q)).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledWith(2000);
    const busy = createWorker({
      url: 'https://w.example',
      fetch: (async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '60' } })) as never,
      budget: free(),
      sleep: none,
    });
    const e = await busy.trips(q).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BusyError);
    expect((e as BusyError).retryAfterS).toBe(60);
    expect((e as BusyError).message).toContain('busy');
  });

  it('anything else wrong is "unavailable", and nothing wrong is kept', async () => {
    let ok = false;
    const fetch = vi.fn(async () =>
      ok ? new Response(answer) : new Response('', { status: 502 }),
    );
    const w = createWorker({ url: 'https://w.example', fetch: fetch as never, budget: free() });
    await expect(w.trips(q)).rejects.toBeInstanceOf(UnavailableError);
    ok = true;
    await expect(w.trips(q)).resolves.toEqual([]);
    const down = createWorker({
      url: 'https://w.example',
      fetch: (async () => {
        throw new Error('network');
      }) as never,
      budget: free(),
    });
    await expect(down.journey({ journey: 'x', day: '2026-11-07' })).rejects.toBeInstanceOf(
      UnavailableError,
    );
  });

  it('the budget holds calls to the limit, in order, then refuses', async () => {
    let t = 0;
    const waits: number[] = [];
    const b = new CallBudget(
      2,
      60_000,
      () => t,
      async (ms) => void waits.push(ms),
    );
    await b.take();
    await b.take();
    expect(waits).toEqual([]);
    t = 10_000;
    await b.take();
    expect(waits).toEqual([50_000]);
    const refused = new CallBudget(1, 1000, () => 0, none);
    await refused.take();
    const e = await refused.take().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BusyError);
    expect((e as BusyError).retryAfterS).toBe(60);
    const queued = new CallBudget(
      1,
      120_000,
      () => 0,
      async (ms) => void waits.push(ms),
    );
    waits.length = 0;
    await queued.take();
    await queued.take();
    await queued.take();
    expect(waits).toEqual([60_000, 120_000]);
  });
});

describe('over HTTP, with the real MCP client', () => {
  const SECRET = 's3cret-that-is-long-enough-to-pass-a-check';
  const servers: { close: () => void }[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });
  const start = async (over: Partial<ToolDeps> = {}) => {
    const lines: string[] = [];
    const server = createHttpServer({
      keys: checkWith([], SECRET),
      tools: createTools(deps(over)),
      log: (l) => lines.push(JSON.stringify(l)),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, lines };
  };
  const connect = async (base: string) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${SECRET}`)));
    servers.push({ close: () => void client.close() });
    return client;
  };
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

  it('lists the five tools and plans, and logs nothing about the route or the secret', async () => {
    const { base, lines } = await start();
    const client = await connect(base);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([
      'find_stops',
      'list_scenic_lines',
      'more_options',
      'plan_trip',
      'train_status',
    ]);
    const r = await client.callTool({ name: 'plan_trip', arguments: T5 });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r)).options.length).toBeGreaterThan(0);
    const logged = lines.join('\n');
    expect(logged).toContain('plan_trip');
    expect(logged).toContain('{"key":"legacy","via":"path"}');
    for (const secret of [SECRET, 'Interlaken', 'Scheidegg', FIXTURE_DATE])
      expect(logged).not.toContain(secret);
  });

  it('refuses a parameter it does not know, and names the one meant (retest N1)', async () => {
    const { base } = await start();
    const client = await connect(base);
    const plan = (await client.listTools()).tools.find((t) => t.name === 'plan_trip')!;
    const schema = plan.inputSchema as unknown as {
      additionalProperties?: boolean;
      properties: { stops: { items: { additionalProperties?: boolean } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.stops.items.additionalProperties).toBe(false);
    const top = await client.callTool({
      name: 'plan_trip',
      arguments: { ...T5, strict: true, return: 'scenic' },
    });
    expect(top.isError).toBe(true);
    expect(text(top)).toContain('`return`');
    expect(text(top)).toContain('returnWay');
    const inStop = await client.callTool({
      name: 'plan_trip',
      arguments: { ...T5, stops: [{ ...T5.stops[0], openUntil: '18:00' }, ...T5.stops.slice(1)] },
    });
    expect(inStop.isError).toBe(true);
    expect(text(inStop)).toContain('`openUntil`');
    expect(text(inStop)).toContain('leaveBy');
    const find = await client.callTool({ name: 'find_stops', arguments: { query: 'Bern', q: 1 } });
    expect(find.isError).toBe(true);
    expect(text(find)).toContain('`q`');
  });

  it('answers a tool’s error as one, in words, and hides what it does not know', async () => {
    const { base, lines } = await start({
      timetable: {
        ...deps().timetable,
        journey: async () => {
          throw new Error('the secret path /mcp/abc');
        },
      },
    });
    const client = await connect(base);
    const bad = await client.callTool({
      name: 'plan_trip',
      arguments: { date: FIXTURE_DATE, stops: [{ name: 'Xqzzz' }, { name: 'Bern' }] },
    });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('unknown stop: Xqzzz');
    expect(lines.join('\n')).not.toContain('Xqzzz');
    const odd = await client.callTool({
      name: 'train_status',
      arguments: { journey: '2026-11-07:ch:1:sjyid:1' },
    });
    expect(odd.isError).toBe(true);
    expect(text(odd)).toBe('internal error');
    expect(lines.join('\n')).not.toContain('/mcp/abc');
  });

  it('only the secret’s address answers; the health check asks nothing of the Worker', async () => {
    const trips = vi.fn();
    const { base } = await start({ timetable: { ...deps().timetable, trips } });
    const post = (path: string, body = '{}') =>
      fetch(`${base}${path}`, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
      });
    expect((await post('/mcp/wrong')).status).toBe(404);
    expect((await post(`/mcp/${SECRET}x`)).status).toBe(404);
    expect((await post(`/${SECRET}`)).status).toBe(404);
    expect((await fetch(`${base}/mcp/wrong`)).status).toBe(404);
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(trips).not.toHaveBeenCalled();
    expect((await fetch(`${base}/mcp/${SECRET}`)).status).toBe(405);
    // The secret as a bearer token on /mcp, which no proxy or client logs as a path.
    const bearer = (token: string, method = 'POST') =>
      fetch(`${base}/mcp`, {
        method,
        body: method === 'POST' ? '{}' : undefined,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
    expect((await post('/mcp')).status).toBe(401);
    expect((await post('/mcp/')).status).toBe(401);
    expect((await bearer('wrong')).status).toBe(401);
    expect((await bearer(`${SECRET}x`)).status).toBe(401);
    expect((await bearer(SECRET, 'GET')).status).toBe(405);
    expect((await bearer(SECRET)).status).not.toBe(401);
    const client = new Client({ name: 'bearer', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${SECRET}` } },
      }),
    );
    servers.push({ close: () => void client.close() });
    expect((await client.listTools()).tools.map((t) => t.name)).toHaveLength(5);
    expect((await post(`/mcp/${SECRET}`, 'x'.repeat(257 * 1024))).status).toBe(413);
    expect((await post(`/mcp/${SECRET}`, 'not json')).status).toBe(400);
  });

  it('a slow plan answers in time, and the client can come back for it', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { base } = await start({
      waitMs: 20,
      timetable: {
        ...deps().timetable,
        trips: async (q) => {
          await gate;
          return ojpFor('T5').fetchTrips(q);
        },
      },
    });
    const client = await connect(base);
    const first = await client.callTool({ name: 'plan_trip', arguments: T5 });
    expect(JSON.parse(text(first)).status).toBe('still_planning');
    release();
    await vi.waitFor(async () => {
      const r = await client.callTool({ name: 'plan_trip', arguments: T5 });
      expect(JSON.parse(text(r)).options.length).toBeGreaterThan(0);
    });
  });
});

// Reported on the MCP, 5 Nov 2026 (second report).
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
