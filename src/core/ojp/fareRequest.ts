// Fares (0.30.0, OJP Fare, beta: https://api.opentransportdata.swiss/ojpfare): its request takes
// a whole OJP Trip, as a trip answer holds it, and the traveller (class, Half Fare card). The
// Worker never forwards XML from the app: it asks OJP for the trip itself, takes from OJP's own
// answer the one whose trains are the app's (`pickTrip`), and asks OJP Fare for that one.
// Shared by the app (the query) and the Worker (the requests); pure.
import type { StopRef } from './request';
import { zurichDateTime } from './request';

export interface FareQuery {
  origin: StopRef;
  destination: StopRef;
  vias: StopRef[];
  /** When the first train leaves, local Swiss time `YYYY-MM-DDTHH:MM`. */
  time: string;
  /** The rides' journeys in order (OJP JourneyRefs, without their day). */
  journeys: string[];
  travelClass: 1 | 2;
  halfFare: boolean;
}

const REF = /^(ch:1:sloid:\d{1,7}(:\d+){0,2}|\d{7})$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const JOURNEY = /^[\w:.-]{1,120}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const stop = (v: unknown): StopRef | null =>
  isObj(v) &&
  typeof v.ref === 'string' &&
  REF.test(v.ref) &&
  typeof v.name === 'string' &&
  v.name.length > 0 &&
  v.name.length <= 80
    ? { ref: v.ref, name: v.name }
    : null;

export function parseFareQuery(v: unknown): FareQuery | string {
  if (!isObj(v)) return 'body';
  const origin = stop(v.origin);
  const destination = stop(v.destination);
  if (!origin) return 'origin';
  if (!destination) return 'destination';
  const viasIn = v.vias ?? [];
  if (!Array.isArray(viasIn) || viasIn.length > 10) return 'vias';
  const vias = viasIn.map(stop);
  if (vias.some((x) => !x)) return 'vias';
  if (typeof v.time !== 'string' || !TIME.test(v.time) || Number.isNaN(Date.parse(v.time)))
    return 'time';
  const j = v.journeys;
  if (
    !Array.isArray(j) ||
    j.length < 1 ||
    j.length > 20 ||
    j.some((x) => typeof x !== 'string' || !JOURNEY.test(x))
  )
    return 'journeys';
  if (v.travelClass !== 1 && v.travelClass !== 2) return 'travelClass';
  return {
    origin,
    destination,
    vias: vias as StopRef[],
    time: v.time,
    journeys: j as string[],
    travelClass: v.travelClass,
    halfFare: v.halfFare === true,
  };
}

const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const placeRef = (s: StopRef) =>
  `<PlaceRef><StopPlaceRef>${esc(s.ref)}</StopPlaceRef><Name><Text>${esc(s.name)}</Text></Name></PlaceRef>`;
const envelope = (body: string, now: Date, requestor: string) => {
  const ts = now.toISOString();
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">' +
    `<OJPRequest><siri:ServiceRequest><siri:RequestTimestamp>${ts}</siri:RequestTimestamp>` +
    `<siri:RequestorRef>${esc(requestor)}</siri:RequestorRef>` +
    body.replace('%TS%', `<siri:RequestTimestamp>${ts}</siri:RequestTimestamp>`) +
    '</siri:ServiceRequest></OJPRequest></OJP>'
  );
};

/** The trip itself, as OJP Fare needs it: no track, no stops between (they only weigh). */
export function fareTripRequestXml(q: FareQuery, now: Date, requestor: string): string {
  const body =
    '<OJPTripRequest>%TS%' +
    `<Origin>${placeRef(q.origin)}<DepArrTime>${zurichDateTime(q.time)}</DepArrTime></Origin>` +
    `<Destination>${placeRef(q.destination)}</Destination>` +
    q.vias
      .map((v) => `<Via><ViaPoint><StopPlaceRef>${esc(v.ref)}</StopPlaceRef></ViaPoint></Via>`)
      .join('') +
    '<Params><NumberOfResults>6</NumberOfResults>' +
    '<UseRealtimeData>none</UseRealtimeData></Params></OJPTripRequest>';
  return envelope(body, now, requestor);
}

/**
 * The `<Trip>` of a trip answer whose rides are these journeys, in order (a walk between is
 * no ride); undefined when the answer holds none of them. A string, as OJP wrote it.
 */
export function pickTrip(answer: string, journeys: string[]): string | undefined {
  const trips = answer.match(/<(?:\w+:)?Trip>[\s\S]*?<\/(?:\w+:)?Trip>/g) ?? [];
  const want = journeys.join('|');
  return trips.find((t) => {
    const refs = [...t.matchAll(/<(?:\w+:)?JourneyRef>([^<]+)<\/(?:\w+:)?JourneyRef>/g)].map(
      (m) => m[1],
    );
    return refs.join('|') === want;
  });
}

/** OJP Fare's question for that trip (NOVA, the Swiss tariff), with a Half Fare card or none. */
export function fareRequestXml(trip: string, q: FareQuery, now: Date, requestor: string): string {
  // Without a card the traveller says so with an empty list: OJP2NOVA answers a traveller
  // without the list, no traveller or no class with a 500 (Nov 2026).
  const card = q.halfFare
    ? '<EntitlementProduct><FareAuthorityRef>ch:1:NOVA</FareAuthorityRef>' +
      '<EntitlementProductRef>HTA</EntitlementProductRef>' +
      '<EntitlementProductName>Halbtax-Abonnement</EntitlementProductName>' +
      '</EntitlementProduct>'
    : '';
  const body =
    `<OJPFareRequest>%TS%<TripFareRequest>${trip}</TripFareRequest>` +
    '<Params><FareAuthorityFilter>ch:1:NOVA</FareAuthorityFilter>' +
    `<FareClass>${q.travelClass === 1 ? 'firstClass' : 'secondClass'}</FareClass>` +
    '<Traveller><Age>30</Age><PassengerCategory>Adult</PassengerCategory>' +
    `<EntitlementProducts>${card}</EntitlementProducts></Traveller>` +
    '</Params></OJPFareRequest>';
  return envelope(body, now, requestor);
}
