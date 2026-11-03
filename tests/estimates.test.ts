// Delays the timetable service knows as it answers (asked on the day): kept beside the
// timetable's times, never in their place. The timetable is the plan; the estimate is how it
// is going (0.15.0). No recorded answer carries <EstimatedTime>, so the XML is made here.
import { describe, expect, it } from 'vitest';
import { liveRides, liveState } from '../src/core/live';
import { noticesFor } from '../src/core/notify';
import type { JourneyStatus } from '../src/core/ojp/journey';
import type { TripQuery } from '../src/core/ojp/request';
import { parseTrips } from '../src/core/ojp/parse';
import { zurichDateTime } from '../src/core/ojp/request';
import { expectedArr, expectedDep, rides } from '../src/core/planner/connection';
import { plan } from '../src/core/planner/plan';
import { refreshChain } from '../src/core/refresh';
import { newTrip } from '../src/core/trip';
import { newTour, addWaypoint, setStop } from './helpers/edit';
import { DATE, conn, deps, ref, ride, templates } from './helpers/timetable';

const at = (hhmm: string) => zurichDateTime(`${DATE}T${hhmm}`);
const ms = (hhmm: string) => Date.parse(at(hhmm));

const stopXml = (tag: string, ref: string, name: string, times: string) =>
  `<${tag}><siri:StopPointRef>${ref}</siri:StopPointRef><StopPointName><Text xml:lang="de">${name}</Text></StopPointName>${times}</${tag}>`;
const when = (kind: 'ServiceDeparture' | 'ServiceArrival', planned: string, est?: string) =>
  `<${kind}><TimetabledTime>${planned}</TimetabledTime>${est ? `<EstimatedTime>${est}</EstimatedTime>` : ''}</${kind}>`;
const utc = (hhmm: string) => new Date(ms(hhmm)).toISOString().replace('.000Z', 'Z');

/** One trip Zürich HB → Chur with one intermediate stop, times as given. */
const doc = (opts: { depEst?: string; midEst?: string; arrEst?: string }) =>
  `<?xml version="1.0" encoding="utf-8"?><OJP xmlns:siri="http://www.siri.org.uk/siri" version="2.0" xmlns="http://www.vdv.de/ojp"><OJPResponse><siri:ServiceDelivery><OJPTripDelivery><TripResult><Id>1</Id><Trip><Id>1</Id><Duration>PT1H15M</Duration><StartTime>${utc('07:07')}</StartTime><EndTime>${utc('08:22')}</EndTime><Transfers>0</Transfers><Leg><Id>1</Id><Duration>PT1H15M</Duration><TimedLeg>` +
  stopXml(
    'LegBoard',
    'ch:1:sloid:3000:5:8',
    'Zürich HB',
    `<PlannedQuay><Text xml:lang="de">8</Text></PlannedQuay>${when('ServiceDeparture', utc('07:07'), opts.depEst && utc(opts.depEst))}`,
  ) +
  stopXml(
    'LegIntermediate',
    'ch:1:sloid:3005:1:3',
    'Sargans',
    when('ServiceArrival', utc('08:00'), opts.midEst && utc(opts.midEst)) +
      when('ServiceDeparture', utc('08:01'), opts.midEst && utc(opts.midEst)),
  ) +
  stopXml(
    'LegAlight',
    'ch:1:sloid:9000:5:9',
    'Chur',
    when('ServiceArrival', utc('08:22'), opts.arrEst && utc(opts.arrEst)),
  ) +
  `<Service><OperatingDayRef>${DATE}</OperatingDayRef><JourneyRef>ch:1:sjyid:100001:1057-001</JourneyRef><Mode><PtMode>rail</PtMode></Mode><ProductCategory><Name><Text xml:lang="de">InterCity</Text></Name><ShortName><Text xml:lang="de">IC</Text></ShortName></ProductCategory><PublishedServiceName><Text xml:lang="de">IC3</Text></PublishedServiceName><TrainNumber>1057</TrainNumber></Service></TimedLeg></Leg></Trip></TripResult></OJPTripDelivery></siri:ServiceDelivery></OJPResponse></OJP>`;

describe('parsing a delayed train', () => {
  it('keeps the timetable as the times, the estimate beside them', () => {
    const [c] = parseTrips(doc({ depEst: '07:17', midEst: '08:11', arrEst: '08:30' }));
    const [s] = rides(c!).map(([x]) => x);
    expect(s!.from).toMatchObject({ dep: utc('07:07'), depEst: utc('07:17') });
    expect(s!.intermediate[0]).toMatchObject({ arr: utc('08:00'), arrEst: utc('08:11') });
    expect(s!.to).toMatchObject({ arr: utc('08:22'), arrEst: utc('08:30') });
    expect(c).toMatchObject({
      dep: utc('07:07'),
      arr: utc('08:22'),
      depEst: utc('07:17'),
      arrEst: utc('08:30'),
    });
  });

  it('on time, or without an estimate: no estimate kept', () => {
    const [c] = parseTrips(doc({ depEst: '07:07' }));
    expect(c).not.toHaveProperty('depEst');
    expect(rides(c!)[0]![0].from).not.toHaveProperty('depEst');
    expect(parseTrips(doc({}))[0]).not.toHaveProperty('arrEst');
    expect(expectedDep(c!)).toBe(c!.dep);
    expect(expectedArr(c!)).toBe(c!.arr);
  });
});

// Zürich → Luzern (late) → Interlaken Ost.
const late = (depEst?: string, arrEst?: string) => {
  const c = conn(
    ride(
      'IR 70',
      [
        ['Zürich HB', '08:04'],
        ['Luzern', '08:45'],
      ],
      { journey: 'j1' },
    ),
  );
  const s = c.sections[0]!;
  if (depEst) s.from.depEst = at(depEst);
  if (arrEst) s.to.arrEst = at(arrEst);
  return {
    ...c,
    ...(depEst ? { depEst: at(depEst) } : {}),
    ...(arrEst ? { arrEst: at(arrEst) } : {}),
  };
};
const onward = (dep: string, arr: string, journey: string) =>
  conn(
    ride(
      'PE LIX',
      [
        ['Luzern', dep],
        ['Interlaken Ost', arr],
      ],
      { journey },
    ),
  );

describe('planning with a delay known', () => {
  const stop = (name: string) => ({ stopRef: ref(name), name });
  const tour = {
    ...setStop(
      addWaypoint(
        addWaypoint(newTour('t', DATE, stop('Zürich HB')), stop('Luzern')),
        stop('Interlaken Ost'),
      ),
      1,
      true,
      0,
    ),
    anchor: { departAt: '08:00' },
  };

  it('a change the delay has lost is not planned; the next train is', async () => {
    // Arrives 08:45 by the timetable, 09:00 expected: the 08:51 cannot be caught.
    const { deps: d } = deps([
      late('08:04', '09:00'),
      onward('08:51', '10:41', 'j2'),
      onward('09:51', '11:41', 'j3'),
    ]);
    const r = await plan(tour, d);
    const chain = r.recommended!.connections;
    expect(chain[1]!.sections[0]!.journey).toBe('j3');
    // The times shown stay the timetable's; the delay is beside them.
    expect(chain[0]!.arr).toBe(at('08:45'));
    expect(chain[0]!.arrEst).toBe(at('09:00'));
  });

  it('without a delay the first change stands', async () => {
    const { deps: d } = deps([
      late(),
      onward('08:51', '10:41', 'j2'),
      onward('09:51', '11:41', 'j3'),
    ]);
    const r = await plan(tour, d);
    expect(r.recommended!.connections[1]!.sections[0]!.journey).toBe('j2');
  });

  it('a change tight across two legs is said, as the live view will say it', async () => {
    const tight = await plan(tour, deps([late(), onward('08:48', '10:41', 'j2')]).deps);
    // Said once, on the ride you leave.
    expect(tight.recommended!.warnings.filter((w) => w.type === 'tight-transfer')).toEqual([
      expect.objectContaining({ legIndex: 0, sectionIndex: 0, params: { min: 3, at: 'Luzern' } }),
    ]);
    expect(liveState(tight.recommended!.connections, ms('08:30')).risks).toEqual([
      { ride: 1, marginMin: 3, reason: 'tight' },
    ]);
    const easy = await plan(tour, deps([late(), onward('09:51', '11:41', 'j3')]).deps);
    expect(easy.recommended!.warnings.some((w) => w.type === 'tight-transfer')).toBe(false);
  });
});

describe('the delay the plan was made with', () => {
  const chain = [late('08:14', '08:55'), onward('09:51', '11:41', 'j2')];

  it('shows until the train reports, then what it reports, on time included', () => {
    const planned = liveRides(chain, new Map())[0]!;
    expect(planned.stops[0]).toMatchObject({ depPlan: ms('08:04'), dep: ms('08:14') });
    expect(liveState(chain, ms('08:00')).next).toMatchObject({ kind: 'board', delayMin: 10 });
    const status: JourneyStatus = {
      cancelled: false,
      calls: [
        {
          key: ref('Zürich HB'),
          name: 'Zürich HB',
          dep: at('08:04'),
          passed: true,
          cancelled: false,
        },
        { key: ref('Luzern'), name: 'Luzern', arr: at('08:45'), passed: false, cancelled: false },
      ],
    };
    const reported = liveRides(chain, new Map([['j1', status]]))[0]!;
    expect(reported.stops[0]!.dep).toBe(ms('08:04'));
    expect(reported.stops.at(-1)!.arr).toBe(ms('08:45'));
  });

  it('notifications come for the times expected', () => {
    const trip = newTrip(
      't',
      { ...newTour('t', DATE), name: 'x' },
      [],
      { connections: chain, warnings: [], dep: chain[0]!.dep, arr: chain[1]!.arr } as never,
      new Date(0),
    );
    const n = noticesFor(trip, 0, templates, () => undefined);
    expect(n.find((x) => x.kind === 'depart')!.at).toBe(ms('08:14') - 10 * 60_000);
    expect(n.find((x) => x.kind === 'exit')!.at).toBe(ms('08:55') - 5 * 60_000);
  });

  it('asked again, the question is from the timetable; the answer brings the delay', async () => {
    const t = newTrip(
      't',
      { ...newTour('t', DATE), name: 'x' },
      [],
      { connections: chain, warnings: [], dep: chain[0]!.dep, arr: chain[1]!.arr } as never,
      new Date(0),
    );
    const asked: string[] = [];
    const r = await refreshChain(t, {
      ...deps([]).deps,
      today: DATE,
      ask: async (q: TripQuery) => {
        asked.push(q.time);
        return q.origin.name === 'Zürich HB'
          ? [late('08:24', '09:05')]
          : [onward('09:51', '11:41', 'j2')];
      },
    } as never);
    expect(asked[0]).toBe(`${DATE}T08:04`);
    const c0 = r.chain.connections[0]!;
    expect([Date.parse(c0.arr), Date.parse(c0.arrEst!)]).toEqual([ms('08:45'), ms('09:05')]);
    expect(r.chain.connections[1]).not.toHaveProperty('arrEst');
  });
});
