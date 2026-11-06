// OJP 2.0 TripInfoDelivery → the live calls of one vehicle (recorded: tests/fixtures/ojp/tripinfo/).
// PreviousCall = already served, OnwardCall = still to come; EstimatedTime only when known.
import { XMLParser } from 'fast-xml-parser';
import { stopKey } from '../stops';
import { OjpError } from './parse';

export interface LiveCall {
  key: string;
  name: string;
  arr?: string;
  dep?: string;
  /** Estimated times; absent when on time is all OJP knows. */
  arrEst?: string;
  depEst?: string;
  platform?: string;
  /** The platform in the timetable, when `platform` is a later one. */
  platformPlanned?: string;
  passed: boolean;
  cancelled: boolean;
}

export interface JourneyStatus {
  calls: LiveCall[];
  cancelled: boolean;
  /** The operator's notices about this train. */
  notices?: string[];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (n) => n === 'PreviousCall' || n === 'OnwardCall' || n === 'Text' || n === 'PtSituation',
});

type X = Record<string, unknown> | undefined;
const obj = (v: unknown): X =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const arr = (v: unknown): X[] => (Array.isArray(v) ? v.map(obj) : v === undefined ? [] : [obj(v)]);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const text = (v: unknown) => {
  const t = obj(v)?.Text;
  return Array.isArray(t) ? str(t[0]) : str(t);
};

function call(c: X, passed: boolean): LiveCall {
  const a = obj(c?.ServiceArrival);
  const d = obj(c?.ServiceDeparture);
  return {
    key: stopKey(str(c?.StopPointRef) ?? ''),
    name: text(c?.StopPointName) ?? '',
    arr: str(a?.TimetabledTime),
    dep: str(d?.TimetabledTime),
    arrEst: str(a?.EstimatedTime),
    depEst: str(d?.EstimatedTime),
    platform: text(c?.EstimatedQuay) ?? text(c?.PlannedQuay),
    platformPlanned: text(c?.PlannedQuay),
    passed,
    cancelled: str(c?.NotServicedStop) === 'true',
  };
}

/** The timetable has no such journey on that day: an answer, not the service failing. */
export class UnknownJourneyError extends OjpError {
  constructor() {
    super('no such journey on that day');
  }
}

export function parseJourney(xml: string): JourneyStatus {
  const delivery = obj(
    obj(obj(obj(parser.parse(xml))?.OJP)?.OJPResponse)?.ServiceDelivery,
  )?.OJPTripInfoDelivery;
  const d = obj(delivery);
  if (!d) throw new OjpError('no TripInfoDelivery');
  const err = obj(d.ErrorCondition);
  const problem = err && str(err.TripInfoProblemType);
  if (problem === 'TRIPINFO_NOJOURNEYFOUND') throw new UnknownJourneyError();
  if (err) throw new OjpError(problem ?? 'OJP error');
  const r = obj(d.TripInfoResult);
  const notices = arr(obj(obj(d.TripInfoResponseContext)?.Situations)?.PtSituation).flatMap((s) =>
    arr(
      obj(obj(obj(s?.PublishingActions)?.PublishingAction)?.PassengerInformationAction)
        ?.TextualContent,
    )
      .map(
        (c) =>
          text(obj(c?.SummaryContent)?.SummaryText) ?? str(obj(c?.SummaryContent)?.SummaryText),
      )
      .filter((x): x is string => !!x)
      .slice(0, 1),
  );
  return {
    calls: [
      ...arr(r?.PreviousCall).map((c) => call(c, true)),
      ...arr(r?.OnwardCall).map((c) => call(c, false)),
    ],
    cancelled: str(obj(r?.Service)?.Cancelled) === 'true',
    ...(notices.length ? { notices } : {}),
  };
}

/** Minutes late at a call (estimated − timetabled), departure first; 0 when unknown. */
export function delayMin(
  c: Pick<LiveCall, 'arr' | 'dep' | 'arrEst' | 'depEst'>,
  which: 'arr' | 'dep',
): number {
  const plan = which === 'dep' ? (c.dep ?? c.arr) : (c.arr ?? c.dep);
  const est = which === 'dep' ? (c.depEst ?? c.arrEst) : (c.arrEst ?? c.depEst);
  if (!plan || !est) return 0;
  return Math.round((Date.parse(est) - Date.parse(plan)) / 60_000);
}
