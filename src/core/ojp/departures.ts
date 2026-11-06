// OJP 2.0 StopEventDelivery → the trains leaving a stop, each as a ride from it to its last stop
// with every stop it still calls at (the map planner). Shaped by VDV's Swiss example
// (SER_02_response) and recorded answers in tests/fixtures/ojp/departures/: StopEventResult >
// StopEvent > ThisCall / OnwardCall > CallAtStop, the train in Service, as in a trip's legs;
// where each stop lies in the answer's Places.
import { XMLParser } from 'fast-xml-parser';
import type { LatLon, Mode, Section, StopCall } from '../model';
import { stopKey } from '../stops';
import { OjpError } from './parse';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (n) => n === 'StopEventResult' || n === 'OnwardCall' || n === 'Text' || n === 'Place',
});

type X = Record<string, unknown> | undefined;
const obj = (v: unknown): X =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const arr = (v: unknown): X[] => (Array.isArray(v) ? v.map(obj) : v === undefined ? [] : [obj(v)]);
const str = (v: unknown) =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
const text = (v: unknown) => {
  const t = obj(v)?.Text;
  return Array.isArray(t) ? str(t[0]) : str(t);
};

export interface Departures {
  rides: Section[];
  /** Where the answer's stops lie, by stopKey (stops abroad the index does not know too). */
  places: Map<string, LatLon>;
}

function modeOf(service: X): Mode {
  const pt = str(obj(service?.Mode)?.PtMode);
  if (text(obj(service?.ProductCategory)?.ShortName) === 'CC') return 'cog';
  if (pt === 'telecabin' || pt === 'cableway' || pt === 'funicular') return 'cableCar';
  if (pt === 'water' || pt === 'ferry') return 'boat';
  if (pt === 'bus' || pt === 'coach' || pt === 'trolleyBus') return 'bus';
  return 'rail';
}

function callOf(v: X): StopCall & { cancelled: boolean } {
  const c = obj(v?.CallAtStop);
  return {
    stopRef: str(c?.StopPointRef) ?? '',
    name: text(c?.StopPointName) ?? '',
    arr: str(obj(c?.ServiceArrival)?.TimetabledTime),
    dep: str(obj(c?.ServiceDeparture)?.TimetabledTime),
    cancelled: str(c?.NotServicedStop) === 'true',
  };
}

export function parseDepartures(xml: string): Departures {
  const doc = obj(parser.parse(xml));
  const d = obj(obj(obj(obj(doc?.OJP)?.OJPResponse)?.ServiceDelivery)?.OJPStopEventDelivery);
  if (!d) throw new OjpError('no StopEventDelivery');
  const err = obj(d.ErrorCondition);
  if (err) {
    const what = JSON.stringify(err);
    // No departures at all is an answer, not a failure.
    if (/NOSTOPEVENT|NORESULT/i.test(what)) return { rides: [], places: new Map() };
    throw new OjpError(what.slice(0, 200));
  }
  const places = new Map<string, LatLon>();
  for (const p of arr(obj(obj(d.StopEventResponseContext)?.Places)?.Place)) {
    const ref = str(obj(p?.StopPlace)?.StopPlaceRef) ?? str(obj(p?.StopPoint)?.StopPointRef);
    const g = obj(p?.GeoPosition);
    const lat = Number(str(g?.Latitude));
    const lon = Number(str(g?.Longitude));
    if (ref && Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon))
      places.set(stopKey(ref), { lat, lon });
  }
  const rides = arr(d.StopEventResult).flatMap((r): Section[] => {
    const e = obj(r?.StopEvent);
    const service = obj(e?.Service);
    if (str(service?.Cancelled) === 'true') return [];
    const from = callOf(obj(e?.ThisCall));
    const onward = arr(e?.OnwardCall)
      .map(callOf)
      .filter((c) => !c.cancelled && c.stopRef);
    const last = onward.at(-1);
    if (!from.dep || !last) return [];
    const strip = ({ cancelled: _, ...c }: StopCall & { cancelled: boolean }): StopCall => c;
    const day = str(service?.OperatingDayRef);
    const journey = str(service?.JourneyRef);
    const cat = obj(service?.ProductCategory);
    return [
      {
        mode: modeOf(service),
        category: text(cat?.ShortName),
        product: text(cat?.Name),
        line: text(service?.PublishedServiceName) ?? str(service?.PublicCode),
        number: str(service?.TrainNumber),
        journey: day && journey ? `${day}:${journey}` : undefined,
        destination: text(service?.DestinationText),
        from: strip(from),
        to: strip(last),
        intermediate: onward.slice(0, -1).map(strip),
      },
    ];
  });
  return { rides, places };
}
