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
  passed: boolean;
  cancelled: boolean;
}

export interface JourneyStatus {
  calls: LiveCall[];
  cancelled: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (n) => n === 'PreviousCall' || n === 'OnwardCall' || n === 'Text',
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
    passed,
    cancelled: str(c?.NotServicedStop) === 'true',
  };
}

export function parseJourney(xml: string): JourneyStatus {
  const delivery = obj(
    obj(obj(obj(parser.parse(xml))?.OJP)?.OJPResponse)?.ServiceDelivery,
  )?.OJPTripInfoDelivery;
  const d = obj(delivery);
  if (!d) throw new OjpError('no TripInfoDelivery');
  const err = obj(d.ErrorCondition);
  if (err) throw new OjpError(str(err.TripInfoProblemType) ?? 'OJP error');
  const r = obj(d.TripInfoResult);
  return {
    calls: [
      ...arr(r?.PreviousCall).map((c) => call(c, true)),
      ...arr(r?.OnwardCall).map((c) => call(c, false)),
    ],
    cancelled: str(obj(r?.Service)?.Cancelled) === 'true',
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
