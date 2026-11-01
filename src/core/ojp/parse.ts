// OJP 2.0 TripDelivery → Connection[]. Shaped by the answers in tests/fixtures/ojp/ (Nov 2026):
// - cog railways come as PtMode telecabin/funicular with ProductCategory CC;
// - PE ("Panorama Express") covers regular trains too (LIX); reservation-only panorama trains
//   carry attribute A__PR;
// - times are UTC (`…Z`); stop point refs embed the stop's SLOID.
import { XMLParser } from 'fast-xml-parser';
import type { Connection, Mode, Section, StopCall } from '../model';

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

function call(v: X, kind: 'board' | 'alight' | 'mid'): StopCall & { platform?: string } {
  const dep = obj(v?.ServiceDeparture);
  const arr_ = obj(v?.ServiceArrival);
  return {
    stopRef: str(v?.StopPointRef) ?? '',
    name: text(v?.StopPointName) ?? '',
    dep: kind === 'alight' ? undefined : (str(dep?.EstimatedTime) ?? str(dep?.TimetabledTime)),
    arr: kind === 'board' ? undefined : (str(arr_?.EstimatedTime) ?? str(arr_?.TimetabledTime)),
    platform: text(v?.EstimatedQuay) ?? text(v?.PlannedQuay),
  };
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

function timedSection(leg: X, notices: Map<string, string>): Section {
  const service = obj(leg?.Service);
  const cat = obj(service?.ProductCategory);
  const situationIds = arr(obj(service?.SituationFullRefs)?.SituationFullRef)
    .map((r) => str(r?.SituationNumber))
    .filter((x): x is string => !!x);
  const codes = arr(service?.Attribute).map((a) => str(a?.Code));
  const day = str(service?.OperatingDayRef);
  const journey = str(service?.JourneyRef);
  return {
    mode: modeOf(service),
    category: text(cat?.ShortName),
    product: text(cat?.Name),
    line: text(service?.PublishedServiceName) ?? str(service?.PublicCode),
    number: str(service?.TrainNumber),
    from: call(obj(leg?.LegBoard), 'board'),
    to: call(obj(leg?.LegAlight), 'alight'),
    intermediate: arr(leg?.LegIntermediate).map((v) => call(v, 'mid')),
    geometry: geometry(obj(leg?.LegTrack)),
    reservationRequired: codes.includes(RESERVATION_ONLY) || undefined,
    situationIds: situationIds.length ? situationIds : undefined,
    notices: situationIds.length
      ? situationIds.map((id) => notices.get(id)).filter((x): x is string => !!x)
      : undefined,
    journey: day && journey ? `${day}:${journey}` : undefined,
  };
}

function walkSection(leg: X): Section {
  const start = obj(leg?.LegStart);
  const end = obj(leg?.LegEnd);
  return {
    mode: 'walk',
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
    if (id && summary) notices.set(id, summary);
  }

  return arr(delivery.TripResult).flatMap((r): Connection[] => {
    const trip = obj(r?.Trip);
    if (!trip) return [];
    const sections = arr(trip.Leg).flatMap((leg): Section[] => {
      if (leg?.TimedLeg) return [timedSection(obj(leg.TimedLeg), notices)];
      if (leg?.TransferLeg) return [walkSection(obj(leg.TransferLeg))];
      if (leg?.ContinuousLeg) return [walkSection(obj(leg.ContinuousLeg))];
      return [];
    });
    const rides = sections.filter((s) => s.mode !== 'walk');
    if (!rides.length) return [];
    return [
      {
        legIndex: 0,
        dep: rides[0]!.from.dep ?? str(trip.StartTime)!,
        arr: rides.at(-1)!.to.arr ?? str(trip.EndTime)!,
        transfers: Number(str(trip.Transfers) ?? rides.length - 1),
        sections,
      },
    ];
  });
}
