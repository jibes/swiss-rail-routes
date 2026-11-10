// OJP 2.0 TripDelivery → Connection[]. Shaped by the answers in tests/fixtures/ojp/ (Nov 2026):
// - cog railways come as PtMode telecabin/funicular with ProductCategory CC;
// - PE ("Panorama Express") covers regular trains too (LIX); reservation-only panorama trains
//   carry attribute A__PR;
// - times are UTC (`…Z`); stop point refs embed the stop's SLOID.
import { XMLParser } from 'fast-xml-parser';
import type { Connection, Mode, NoticeInfo, Occupancy, PlatformCall, Section } from '../model';
import { gradeNotice } from '../noticeGrade';

const ARRAYS = new Set([
  'TripResult',
  'Leg',
  'LegIntermediate',
  'TrackSection',
  'Position',
  'PtSituation',
  'SituationFullRef',
  'Attribute',
  'Text',
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ARRAYS.has(name),
});

// fast-xml-parser output is untyped; these helpers keep the walking readable.
type X = Record<string, unknown> | undefined;
const obj = (v: unknown): X =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const arr = (v: unknown): X[] => (Array.isArray(v) ? v.map(obj) : v === undefined ? [] : [obj(v)]);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
/** `<Name><Text>…</Text></Name>` → the first text. */
const text = (v: unknown): string | undefined => {
  const t = obj(v)?.Text;
  return Array.isArray(t) ? str(t[0]) : str(t);
};

/** Attribute code for "carries reservation-required panorama cars". */
const RESERVATION_ONLY = 'A__PR';

function modeOf(service: X): Mode {
  const mode = obj(service?.Mode);
  const pt = str(mode?.PtMode);
  const cat = text(obj(service?.ProductCategory)?.ShortName);
  if (cat === 'CC') return 'cog';
  switch (pt) {
    case 'telecabin':
    case 'cableway':
    case 'funicular':
      return 'cableCar';
    case 'water':
    case 'ferry':
      return 'boat';
    case 'bus':
    case 'coach':
    case 'trolleyBus':
      return 'bus';
    default:
      return 'rail';
  }
}

// The timetable's times are the plan (links, calendar, the question asked again later); an
// estimate the service already knows (asked on the day) is kept beside them.
function call(v: X, kind: 'board' | 'alight' | 'mid', places?: Places): PlatformCall {
  const dep = obj(v?.ServiceDeparture);
  const arr_ = obj(v?.ServiceArrival);
  const time = (t: X) => {
    const planned = str(t?.TimetabledTime);
    const expected = str(t?.EstimatedTime);
    return {
      at: planned ?? expected,
      est: expected && planned !== expected ? expected : undefined,
    };
  };
  const d = kind === 'alight' ? undefined : time(dep);
  const a = kind === 'board' ? undefined : time(arr_);
  const ref = str(v?.StopPointRef) ?? '';
  const pos = places?.get(ref);
  return {
    stopRef: ref,
    name: text(v?.StopPointName) ?? '',
    ...(pos ? { pos } : {}),
    dep: d?.at,
    arr: a?.at,
    ...(d?.est ? { depEst: d.est } : {}),
    ...(a?.est ? { arrEst: a.est } : {}),
    ...platforms(text(v?.PlannedQuay), text(v?.EstimatedQuay)),
  };
}

// As times: the timetable's platform is the plan, another one already known beside it.
function platforms(planned?: string, expected?: string) {
  return {
    ...(planned ? { platform: planned } : {}),
    ...(expected && expected !== planned ? { platformEst: expected } : {}),
  };
}

/** SIRI's occupancy levels in three steps: seats free, few seats, standing room or worse. */
const LEVEL: Record<string, Occupancy> = {
  empty: 1,
  manySeatsAvailable: 1,
  fewSeatsAvailable: 2,
  standingRoomOnly: 3,
  crushedStandingRoomOnly: 3,
  full: 3,
  notAcceptingPassengers: 3,
};

/** The fullest each class is expected to be leaving the calls you are on board from. */
function occupancyOf(calls: X[]): Section['occupancy'] {
  const out: [Occupancy | undefined, Occupancy | undefined] = [undefined, undefined];
  for (const c of calls)
    for (const o of arr(c?.ExpectedDepartureOccupancy)) {
      const level = LEVEL[str(o?.OccupancyLevel)?.trim() ?? ''];
      // Trimmed: OJP writes `secondClass ` with a space (recorded, Nov 2026).
      const cls = str(o?.FareClass)?.trim();
      const i = cls === 'firstClass' ? 0 : cls === 'secondClass' ? 1 : undefined;
      if (level && i !== undefined && (out[i] ?? 0) < level) out[i] = level;
    }
  return out[0] || out[1] ? out : undefined;
}

function geometry(track: X): [number, number][] | undefined {
  const pts = arr(track?.TrackSection).flatMap((s) =>
    arr(obj(s?.LinkProjection)?.Position).map(
      (p) => [Number(str(p?.Longitude)), Number(str(p?.Latitude))] as [number, number],
    ),
  );
  const ok = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return ok.length > 1 ? ok : undefined;
}

/** Every value under `key`, anywhere below `v` (a situation's stops sit deep in its scope). */
function findAll(v: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) for (const x of v) findAll(x, key, out);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === key) out.push(...(Array.isArray(x) ? x : [x]));
      findAll(x, key, out);
    }
  return out;
}

/** A situation's validity, stops named and the operator's description and remarks. */
function noticeInfoOf(s: X): NoticeInfo {
  const ends = arr(s?.ValidityPeriod)
    .map((p) => str(p?.EndTime))
    .filter((x): x is string => !!x)
    .sort();
  const affected = [
    ...new Set(
      findAll(s, 'AffectedStopPlace')
        .map((p) => text(obj(p)?.PlaceName) ?? str(obj(p)?.PlaceName))
        .filter((x): x is string => !!x),
    ),
  ];
  const content = arr(
    obj(obj(obj(s?.PublishingActions)?.PublishingAction)?.PassengerInformationAction)
      ?.TextualContent,
  );
  const said = (c: X, box: string, field: string) => {
    const v = obj(c?.[box])?.[field];
    return (Array.isArray(v) ? v : [v]).map((x) => text(x) ?? str(x));
  };
  const detail = content
    .flatMap((c) => [
      ...said(c, 'DescriptionContent', 'DescriptionText'),
      ...said(c, 'RemarkContent', 'Remark'),
    ])
    .filter((x): x is string => !!x);
  const words = content.flatMap((c) => [
    ...said(c, 'SummaryContent', 'SummaryText'),
    ...said(c, 'ConsequenceContent', 'ConsequenceText'),
  ]);
  return {
    grade: gradeNotice(...words.filter((x): x is string => !!x)),
    ...(ends.length ? { until: ends.at(-1)! } : {}),
    ...(affected.length ? { affected } : {}),
    ...(detail.length ? { detail: [...new Set(detail)].join(' ') } : {}),
  };
}

/** Each stop point's position in the answer's context, [lon, lat]. */
type Places = Map<string, [number, number]>;
function placesOf(context: X): Places {
  const out: Places = new Map();
  for (const p of arr(obj(context?.Places)?.Place)) {
    const ref = str(obj(p?.StopPoint)?.StopPointRef);
    const g = obj(p?.GeoPosition);
    const lon = Number(str(g?.Longitude));
    const lat = Number(str(g?.Latitude));
    if (ref && Number.isFinite(lon) && Number.isFinite(lat)) out.set(ref, [lon, lat]);
  }
  return out;
}

function timedSection(
  leg: X,
  notices: Map<string, string>,
  infos: Map<string, NoticeInfo>,
  places?: Places,
): Section {
  const service = obj(leg?.Service);
  const cat = obj(service?.ProductCategory);
  const situationIds = arr(obj(service?.SituationFullRefs)?.SituationFullRef)
    .map((r) => str(r?.SituationNumber))
    .filter((x): x is string => !!x);
  const codes = arr(service?.Attribute).map((a) => str(a?.Code));
  const day = str(service?.OperatingDayRef);
  const journey = str(service?.JourneyRef);
  const served = arr(leg?.LegIntermediate).filter((v) => str(v?.NotServicedStop) !== 'true');
  const occupancy = occupancyOf([obj(leg?.LegBoard), ...served]);
  return {
    mode: modeOf(service),
    category: text(cat?.ShortName),
    product: text(cat?.Name),
    line: text(service?.PublishedServiceName) ?? str(service?.PublicCode),
    number: str(service?.TrainNumber),
    from: call(obj(leg?.LegBoard), 'board', places),
    to: call(obj(leg?.LegAlight), 'alight', places),
    intermediate: served.map((v) => call(v, 'mid', places)),
    geometry: geometry(obj(leg?.LegTrack)),
    reservationRequired: codes.includes(RESERVATION_ONLY) || undefined,
    situationIds: situationIds.length ? situationIds : undefined,
    notices: situationIds.length
      ? situationIds.map((id) => notices.get(id)).filter((x): x is string => !!x)
      : undefined,
    noticeInfo: situationIds.some((id) => notices.has(id))
      ? situationIds.filter((id) => notices.has(id)).map((id) => infos.get(id) ?? {})
      : undefined,
    journey: day && journey ? `${day}:${journey}` : undefined,
    destination: text(service?.DestinationText),
    ...(occupancy ? { occupancy } : {}),
  };
}

/** Minutes of an ISO 8601 duration (`PT1H4M30S`); undefined when there is none. */
export function minutesOf(iso: string | undefined): number | undefined {
  const m = iso && /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Math.round(Number(m[3] ?? 0) / 60);
}

function walkSection(leg: X): Section {
  const start = obj(leg?.LegStart);
  const end = obj(leg?.LegEnd);
  return {
    mode: 'walk',
    walkMin: minutesOf(str(leg?.Duration)),
    from: { stopRef: str(start?.StopPointRef) ?? '', name: text(start?.Name) ?? '' },
    to: { stopRef: str(end?.StopPointRef) ?? '', name: text(end?.Name) ?? '' },
    intermediate: [],
  };
}

export class OjpError extends Error {}

/** Parses an OJP 2.0 TripDelivery. Throws OjpError when the answer is an error or not OJP. */
export function parseTrips(xml: string): Connection[] {
  const doc = obj(parser.parse(xml));
  const delivery = obj(obj(obj(obj(doc?.OJP)?.OJPResponse)?.ServiceDelivery)?.OJPTripDelivery);
  if (!delivery) throw new OjpError('no TripDelivery');
  const err = obj(delivery.ErrorCondition);
  if (err) {
    // No connection is an answer, not a failure: the planner relaxes or reports the leg.
    const problem = str(err.TripProblemType);
    if (problem === 'TRIP_NOTRIPFOUND') return [];
    throw new OjpError(problem ?? text(obj(err.OtherError)?.Description) ?? 'OJP error');
  }

  const notices = new Map<string, string>();
  const infos = new Map<string, NoticeInfo>();
  const places = placesOf(obj(delivery.TripResponseContext));
  for (const s of arr(obj(obj(delivery.TripResponseContext)?.Situations)?.PtSituation)) {
    const id = str(s?.SituationNumber);
    const summary = arr(
      obj(obj(obj(s?.PublishingActions)?.PublishingAction)?.PassengerInformationAction)
        ?.TextualContent,
    )
      .map(
        (c) =>
          text(obj(c?.SummaryContent)?.SummaryText) ?? str(obj(c?.SummaryContent)?.SummaryText),
      )
      .find(Boolean);
    if (id && summary) {
      notices.set(id, summary);
      infos.set(id, noticeInfoOf(s));
    }
  }

  return arr(delivery.TripResult).flatMap((r): Connection[] => {
    const trip = obj(r?.Trip);
    if (!trip) return [];
    // A cancelled train is no connection; a stop it no longer serves is not on its way.
    const timed = arr(trip.Leg)
      .map((leg) => obj(leg?.TimedLeg))
      .filter(Boolean);
    const out = (v: X) => str(v?.NotServicedStop) === 'true';
    if (
      timed.some(
        (l) =>
          str(obj(l?.Service)?.Cancelled) === 'true' ||
          out(obj(l?.LegBoard)) ||
          out(obj(l?.LegAlight)),
      )
    )
      return [];
    const sections = arr(trip.Leg).flatMap((leg): Section[] => {
      if (leg?.TimedLeg) return [timedSection(obj(leg.TimedLeg), notices, infos, places)];
      if (leg?.TransferLeg) return [walkSection(obj(leg.TransferLeg))];
      if (leg?.ContinuousLeg) return [walkSection(obj(leg.ContinuousLeg))];
      return [];
    });
    const rides = sections.filter((s) => s.mode !== 'walk');
    if (!rides.length) return [];
    // From the leg's first stop to its last: a walk at either end counts (from the station to
    // the replacement bus outside it, from the pier to the station).
    const walks = (list: Section[]) => {
      let n = 0;
      for (const s of list) {
        if (s.mode !== 'walk') break;
        n += s.walkMin ?? 0;
      }
      return n * 60_000;
    };
    const shift = (iso: string | undefined, ms: number) =>
      iso && ms ? new Date(Date.parse(iso) + ms).toISOString().replace('.000Z', 'Z') : iso;
    const [first, last] = [rides[0]!.from, rides.at(-1)!.to];
    const depEst = shift(first.depEst, -walks(sections));
    const arrEst = shift(last.arrEst, walks([...sections].reverse()));
    return [
      {
        legIndex: 0,
        dep: shift(first.dep, -walks(sections)) ?? str(trip.StartTime)!,
        arr: shift(last.arr, walks([...sections].reverse())) ?? str(trip.EndTime)!,
        ...(depEst ? { depEst } : {}),
        ...(arrEst ? { arrEst } : {}),
        transfers: Number(str(trip.Transfers) ?? rides.length - 1),
        sections,
      },
    ];
  });
}
