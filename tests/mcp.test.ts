// The MCP server (mcp/): tools on recorded OJP answers, and the real SDK client over real HTTP.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRoute, routeLinkOf, resolveWhen } from '../mcp/src/route';
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
import { ga, index, templates } from './helpers/timetable';

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

  it('stay 0 or none rides through; a stay at the very start or end means nothing', () => {
    const t = route({
      date: FIXTURE_DATE,
      stops: [
        { name: 'Bern', stay: 30 },
        { name: 'Thun', stay: 0 },
        { name: 'Spiez', stay: 45 },
        { name: 'Brig', stay: 10 },
      ],
    });
    expect(t.waypoints.map((w) => [w.kind, w.dwellMin])).toEqual([
      ['start', 0],
      ['via', 0],
      ['stop', 45],
      ['end', 0],
    ]);
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
  });

  it('train_status: stops with planned and expected times, delays, and when it was asked', async () => {
    const tools = createTools(deps());
    const r = await tools.trainStatus({ journey: '2026-11-07:ch:1:sjyid:100001:726-001' });
    expect(r.date).toBe('2026-11-07');
    expect(r.journey).toBe('ch:1:sjyid:100001:726-001');
    expect(r.stops.length).toBeGreaterThan(1);
    expect(r.stops[0]).toHaveProperty('plannedDep');
    expect(r.stops.some((s) => s.passed)).toBe(true);
    expect(r.fetchedAt).toBe('2026-11-02T09:00');
    await expect(tools.trainStatus({ journey: 'ch:1:sjyid:100001:726-001' })).rejects.toThrow(
      'bad date',
    );
    await expect(tools.trainStatus({ journey: '<x/>', date: '2026-11-07' })).rejects.toThrow(
      'bad journey',
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
      secret: SECRET,
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
    for (const secret of [SECRET, 'Interlaken', 'Scheidegg', FIXTURE_DATE])
      expect(logged).not.toContain(secret);
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
