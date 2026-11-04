// Platforms as times: the timetable's is the plan, one already known beside it. And where each
// train goes, as the boards say it, left out when it ends where you get off.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { liveRides, platformAt, platformMoved } from '../src/core/live';
import type { JourneyStatus } from '../src/core/ojp/journey';
import { parseTrips } from '../src/core/ojp/parse';
import { zurichDateTime } from '../src/core/ojp/request';
import { towards } from '../src/core/rows';
import { DATE, conn, ref, ride } from './helpers/timetable';

const utc = (hhmm: string) =>
  new Date(Date.parse(zurichDateTime(`${DATE}T${hhmm}`))).toISOString().replace('.000Z', 'Z');
const quay = (planned?: string, expected?: string) =>
  (planned ? `<PlannedQuay><Text xml:lang="de">${planned}</Text></PlannedQuay>` : '') +
  (expected ? `<EstimatedQuay><Text xml:lang="de">${expected}</Text></EstimatedQuay>` : '');
const stop = (tag: string, r: string, name: string, inner: string) =>
  `<${tag}><siri:StopPointRef>${r}</siri:StopPointRef><StopPointName><Text xml:lang="de">${name}</Text></StopPointName>${inner}</${tag}>`;

/** Zürich HB → Chur, platforms and destination as given. */
const doc = (o: { planned?: string; expected?: string; destination?: string }) =>
  `<?xml version="1.0" encoding="utf-8"?><OJP xmlns:siri="http://www.siri.org.uk/siri" version="2.0" xmlns="http://www.vdv.de/ojp"><OJPResponse><siri:ServiceDelivery><OJPTripDelivery><TripResult><Id>1</Id><Trip><Id>1</Id><Duration>PT1H15M</Duration><StartTime>${utc('07:07')}</StartTime><EndTime>${utc('08:22')}</EndTime><Transfers>0</Transfers><Leg><Id>1</Id><Duration>PT1H15M</Duration><TimedLeg>` +
  stop(
    'LegBoard',
    'ch:1:sloid:3000:5:8',
    'Zürich HB',
    `${quay(o.planned, o.expected)}<ServiceDeparture><TimetabledTime>${utc('07:07')}</TimetabledTime></ServiceDeparture>`,
  ) +
  stop(
    'LegAlight',
    'ch:1:sloid:9000:5:9',
    'Chur',
    `<ServiceArrival><TimetabledTime>${utc('08:22')}</TimetabledTime></ServiceArrival>`,
  ) +
  `<Service><OperatingDayRef>${DATE}</OperatingDayRef><JourneyRef>ch:1:sjyid:100001:1057-001</JourneyRef><Mode><PtMode>rail</PtMode></Mode><ProductCategory><Name><Text xml:lang="de">InterCity</Text></Name><ShortName><Text xml:lang="de">IC</Text></ShortName></ProductCategory><PublishedServiceName><Text xml:lang="de">IC3</Text></PublishedServiceName><TrainNumber>1057</TrainNumber>${o.destination ? `<DestinationText><Text xml:lang="de">${o.destination}</Text></DestinationText>` : ''}</Service></TimedLeg></Leg></Trip></TripResult></OJPTripDelivery></siri:ServiceDelivery></OJPResponse></OJP>`;

const board = (o: Parameters<typeof doc>[0]) => parseTrips(doc(o))[0]!.sections[0]!.from;

describe('platforms planned and expected', () => {
  it('the timetable is the plan; another known one beside it, only when it differs', () => {
    expect(board({ planned: '8', expected: '9' })).toMatchObject({
      platform: '8',
      platformEst: '9',
    });
    expect(board({ planned: '8', expected: '8' })).not.toHaveProperty('platformEst');
    expect(board({ planned: '8' })).toMatchObject({ platform: '8' });
    // Only an expected one: no plan to show as moved.
    const only = board({ expected: 'A' });
    expect(only).not.toHaveProperty('platform');
    expect(only.platformEst).toBe('A');
    expect(platformAt(only)).toEqual({ now: 'A', moved: undefined });
  });

  it('the recorded answer: both kept apart, one stop with only an expected platform', () => {
    const xml = gunzipSync(readFileSync('tests/fixtures/ojp/estimates/live.xml.gz')).toString();
    const calls = parseTrips(xml).flatMap((c) =>
      c.sections.flatMap((s) => (s.mode === 'walk' ? [] : [s.from, s.to])),
    );
    expect(calls.some((c) => c.platform)).toBe(true);
    // Every expected platform kept is one that differs from the plan, or the only one.
    for (const c of calls) if (c.platformEst) expect(c.platformEst).not.toBe(c.platform);
  });

  const s = ride(
    'IC 1',
    [
      ['Zürich HB', '08:04'],
      ['Luzern', '08:45'],
    ],
    { journey: 'j1' },
  );
  const status = (platform?: string): JourneyStatus => ({
    cancelled: false,
    calls: [
      {
        key: ref('Zürich HB'),
        name: 'Zürich HB',
        dep: zurichDateTime(`${DATE}T08:04`),
        platform,
        passed: false,
        cancelled: false,
      },
    ],
  });
  const changed = [conn({ ...s, from: { ...s.from, platform: '7', platformEst: '9' } })];

  it('a change known as it was planned shows as moved, before the train reports', () => {
    const stopNow = liveRides(changed, new Map())[0]!.stops[0]!;
    expect(stopNow).toMatchObject({ platform: '9', platformPlan: '7' });
    expect(platformMoved(stopNow)).toEqual({ now: '9', was: '7' });
    expect(platformAt(changed[0]!.sections[0]!.from)).toEqual({
      now: '9',
      moved: { now: '9', was: '7' },
    });
  });

  it('a change taken back shows nothing', () => {
    const back = liveRides(changed, new Map([['j1', status('7')]]))[0]!.stops[0]!;
    expect(back.platform).toBe('7');
    expect(platformMoved(back)).toBeUndefined();
    expect(platformAt(changed[0]!.sections[0]!.from, back).moved).toBeUndefined();
  });
});

describe('where the train goes', () => {
  it('is read from the service', () => {
    expect(parseTrips(doc({ destination: 'Disentis/Mustér' }))[0]!.sections[0]!.destination).toBe(
      'Disentis/Mustér',
    );
    expect(parseTrips(doc({}))[0]!.sections[0]!.destination).toBeUndefined();
  });

  it('the recorded answer names each train’s end', () => {
    const xml = gunzipSync(readFileSync('tests/fixtures/ojp/estimates/live.xml.gz')).toString();
    const rides = parseTrips(xml).flatMap((c) => c.sections.filter((x) => x.mode !== 'walk'));
    expect(rides.length).toBeGreaterThan(0);
    expect(rides.every((r) => !!r.destination)).toBe(true);
  });

  it('is left out where it ends where you get off, or for a walk', () => {
    const to = { stopRef: 'x', name: 'Interlaken Ost' };
    expect(towards({ mode: 'rail', destination: 'Interlaken Ost', to })).toBeUndefined();
    expect(towards({ mode: 'rail', destination: 'interlaken ost ', to })).toBeUndefined();
    expect(towards({ mode: 'rail', destination: 'Brig', to })).toBe('Brig');
    expect(towards({ mode: 'rail', to })).toBeUndefined();
    expect(towards({ mode: 'walk', destination: 'Brig', to })).toBeUndefined();
  });
});
