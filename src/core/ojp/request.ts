// OJP 2.0 requests built from typed JSON. Shared by the app and the Worker: the Worker only ever
// sends XML built here, never XML from a client. Element names follow the OJP 2.0 XSD; verify
// against recorded answers (tests/fixtures/ojp/) before relying on a new one.

export interface StopRef {
  /** SLOID (`ch:1:sloid:3000`) or DIDOK number. */
  ref: string;
  name: string;
}

export interface TripQuery {
  origin: StopRef;
  destination: StopRef;
  vias: StopRef[];
  /** Stops the trip must not pass (base-tunnel portals etc.). */
  notVias: string[];
  /** Local Swiss time, `YYYY-MM-DDTHH:MM`. */
  time: string;
  arriveBy: boolean;
  results: number;
}

export interface StopQuery {
  text: string;
  results: number;
}

export interface JourneyQuery {
  /** OJP JourneyRef, e.g. `ch:1:sjyid:100001:726-001`. */
  journey: string;
  /** Operating day, `YYYY-MM-DD`. */
  day: string;
}

export const LIMITS = { vias: 20, notVias: 20, results: 10, text: 80 } as const;

const REF = /^(ch:1:sloid:\d{1,7}(:\d+){0,2}|\d{7})$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function stopRef(v: unknown): StopRef | null {
  if (!isObj(v) || typeof v.ref !== 'string' || typeof v.name !== 'string') return null;
  if (!REF.test(v.ref) || v.name.length === 0 || v.name.length > LIMITS.text) return null;
  return { ref: v.ref, name: v.name };
}

/** Checks untrusted JSON. Returns the query with only known fields, or the first problem. */
export function parseTripQuery(v: unknown): TripQuery | string {
  if (!isObj(v)) return 'body';
  const origin = stopRef(v.origin);
  const destination = stopRef(v.destination);
  if (!origin) return 'origin';
  if (!destination) return 'destination';
  const viasIn = v.vias ?? [];
  if (!Array.isArray(viasIn) || viasIn.length > LIMITS.vias) return 'vias';
  const vias = viasIn.map(stopRef);
  if (vias.some((s) => !s)) return 'vias';
  const notIn = v.notVias ?? [];
  if (
    !Array.isArray(notIn) ||
    notIn.length > LIMITS.notVias ||
    notIn.some((r) => typeof r !== 'string' || !REF.test(r))
  )
    return 'notVias';
  if (typeof v.time !== 'string' || !TIME.test(v.time) || Number.isNaN(Date.parse(v.time)))
    return 'time';
  const results = v.results ?? 6;
  if (!Number.isInteger(results) || (results as number) < 1 || (results as number) > LIMITS.results)
    return 'results';
  return {
    origin,
    destination,
    vias: vias as StopRef[],
    notVias: notIn as string[],
    time: v.time,
    arriveBy: v.arriveBy === true,
    results: results as number,
  };
}

export function parseStopQuery(v: unknown): StopQuery | string {
  if (!isObj(v) || typeof v.text !== 'string') return 'text';
  const text = v.text.trim();
  if (text.length < 2 || text.length > LIMITS.text) return 'text';
  const results = v.results ?? 10;
  if (!Number.isInteger(results) || (results as number) < 1 || (results as number) > LIMITS.results)
    return 'results';
  return { text, results: results as number };
}

const JOURNEY = /^ch:1:sjyid:[\w:.-]{1,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseJourneyQuery(v: unknown): JourneyQuery | string {
  if (!isObj(v) || typeof v.journey !== 'string' || !JOURNEY.test(v.journey)) return 'journey';
  if (typeof v.day !== 'string' || !DAY.test(v.day) || Number.isNaN(Date.parse(v.day)))
    return 'day';
  return { journey: v.journey, day: v.day };
}

/** `2026-11-07:ch:1:sjyid:…` (Section.journey) → the query for its live calls. */
export function journeyQueryOf(journey: string): JourneyQuery | null {
  const m = /^(\d{4}-\d{2}-\d{2}):(.+)$/.exec(journey);
  return m ? { day: m[1]!, journey: m[2]! } : null;
}

const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

/** `2026-11-07T08:00` in Swiss local time → `2026-11-07T08:00:00+01:00` (DST-aware). */
export function zurichDateTime(local: string): string {
  const guess = new Date(`${local}:00Z`);
  const offsetOf = (d: Date) => {
    const name = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Zurich',
      timeZoneName: 'longOffset',
    })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')!.value; // "GMT+01:00"
    return name === 'GMT' ? '+00:00' : name.slice(3);
  };
  // The offset at the UTC guess is right except within the hour of a switch; recheck once.
  const first = offsetOf(guess);
  const sign = first.startsWith('-') ? -1 : 1;
  const [h, m] = first.slice(1).split(':').map(Number) as [number, number];
  const offset = offsetOf(new Date(guess.getTime() - sign * (h * 60 + m) * 60_000));
  return `${local}:00${offset}`;
}

const placeRef = (s: StopRef) =>
  `<PlaceRef><StopPlaceRef>${esc(s.ref)}</StopPlaceRef><Name><Text>${esc(s.name)}</Text></Name></PlaceRef>`;

function envelope(body: string, now: Date, requestor: string): string {
  const ts = now.toISOString();
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">' +
    `<OJPRequest><siri:ServiceRequest><siri:RequestTimestamp>${ts}</siri:RequestTimestamp>` +
    `<siri:RequestorRef>${esc(requestor)}</siri:RequestorRef>` +
    body.replace('%TS%', `<siri:RequestTimestamp>${ts}</siri:RequestTimestamp>`) +
    '</siri:ServiceRequest></OJPRequest></OJP>'
  );
}

export function tripRequestXml(q: TripQuery, now: Date, requestor: string): string {
  const time = `<DepArrTime>${zurichDateTime(q.time)}</DepArrTime>`;
  const body =
    '<OJPTripRequest>%TS%' +
    `<Origin>${placeRef(q.origin)}${q.arriveBy ? '' : time}</Origin>` +
    `<Destination>${placeRef(q.destination)}${q.arriveBy ? time : ''}</Destination>` +
    q.vias
      .map((v) => `<Via><ViaPoint><StopPlaceRef>${esc(v.ref)}</StopPlaceRef></ViaPoint></Via>`)
      .join('') +
    q.notVias.map((r) => `<NotVia><StopPlaceRef>${esc(r)}</StopPlaceRef></NotVia>`).join('') +
    '<Params>' +
    `<NumberOfResults>${q.results}</NumberOfResults>` +
    '<IncludeIntermediateStops>true</IncludeIntermediateStops>' +
    '<IncludeLegProjection>true</IncludeLegProjection>' +
    '<UseRealtimeData>explanatory</UseRealtimeData>' +
    '</Params></OJPTripRequest>';
  return envelope(body, now, requestor);
}

export function stopRequestXml(q: StopQuery, now: Date, requestor: string): string {
  const body =
    '<OJPLocationInformationRequest>%TS%' +
    `<InitialInput><Name>${esc(q.text)}</Name></InitialInput>` +
    `<Restrictions><Type>stop</Type><NumberOfResults>${q.results}</NumberOfResults></Restrictions>` +
    '</OJPLocationInformationRequest>';
  return envelope(body, now, requestor);
}

export function journeyRequestXml(q: JourneyQuery, now: Date, requestor: string): string {
  const body =
    '<OJPTripInfoRequest>%TS%' +
    `<JourneyRef>${esc(q.journey)}</JourneyRef><OperatingDayRef>${esc(q.day)}</OperatingDayRef>` +
    '<Params><IncludeCalls>true</IncludeCalls><IncludeService>true</IncludeService></Params>' +
    '</OJPTripInfoRequest>';
  return envelope(body, now, requestor);
}

/** Stable cache key: the validated query, fields in a fixed order. */
export const cacheKeyOf = (
  kind: 'trip' | 'stops' | 'journey',
  q: TripQuery | StopQuery | JourneyQuery,
) => `${kind}:${JSON.stringify(q)}`;
