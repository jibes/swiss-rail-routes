// A leg abroad (0.33.0; shared with the MCP since 0.35.0): the question to the Worker's /eu/plan
// for an OJP-style leg question, and its answer as the app's connections. The I/O is injected:
// the app (src/io/ojp.ts) and the MCP (mcp/src/worker.ts) each post it their own way. Pure.
import type { Connection, LatLon } from '../model';
import type { TripQuery } from '../ojp/request';
import { zurichDateTime } from '../ojp/request';
import type { StopSearch } from '../stops';
import { euConnections, pinEnds, transitousId, type Local } from './plan';
import { CH_FEED } from './request';

export const isEuLeg = (q: Pick<TripQuery, 'origin' | 'destination'>) =>
  [q.origin, q.destination].some((s) => s.ref.startsWith('eu:'));

/** A Swiss stop Transitous names by its SLOID (`de-DELFI_ch:1:sloid:3000`) is the app's own. */
export const localBySloid =
  (index: Pick<StopSearch, 'byRef'>): Local =>
  (p) => {
    const n = /ch:1:sloid:(\d+)/.exec(p.id ?? '')?.[1];
    const s = n ? index.byRef(`ch:1:sloid:${Number(n)}`) : undefined;
    return s ? { stopRef: s.ref, name: s.name } : undefined;
  };

export interface EuLegDeps {
  index: Pick<StopSearch, 'byRef'>;
  /** Posts a body to the Worker's /eu/plan; its JSON, or a throw on failure. */
  plan: (body: unknown) => Promise<unknown>;
  trace?: (event: string, data?: unknown) => void;
}

/**
 * Transitous' feed for Switzerland, as its answers name it (`ch-opentransportdataswiss26_ch:1:…`):
 * the name carries the timetable year, so it is read from every answer rather than kept fixed;
 * until one is read, the name known when this was written (`CH_FEED`).
 */
let chFeed = CH_FEED;
export const currentChFeed = () => chFeed;
const FEED = /"(ch-[\w-]+?)_ch:1:sloid:\d+/;
/** The Swiss feed's name an answer uses, if it names a Swiss stop by it. */
export function feedIn(answer: unknown): string | undefined {
  return FEED.exec(JSON.stringify(answer ?? null))?.[1];
}

/**
 * From the leg's first station to its last by its vias (two at most, as Transitous names them),
 * asked again without them when that fails (a via it does not know), and with them once more
 * by the Swiss feed's name that answer gives; the leg's ends are the
 * stations asked for (`pinEnds`).
 */
export async function euLeg(q: TripQuery, d: EuLegDeps): Promise<Connection[]> {
  const where = (ref: string): LatLon | undefined => {
    const s = d.index.byRef(ref);
    return s ? { lat: s.lat, lon: s.lon } : undefined;
  };
  const from = where(q.origin.ref);
  const to = where(q.destination.ref);
  if (!from || !to) throw new Error('no position');
  const viasOf = (feed: string) =>
    q.vias
      .map((v) => transitousId(v.ref, feed))
      .filter((v): v is string => !!v)
      .slice(0, 2);
  const body = (vias: string[]) => ({
    from,
    to,
    ...(vias.length ? { vias } : {}),
    time: zurichDateTime(q.time),
    arriveBy: q.arriveBy,
    results: Math.min(5, Math.max(1, q.results)),
  });
  const ask = async (vias: string[]) => {
    const answer = await d.plan(body(vias));
    const feed = feedIn(answer);
    if (feed && feed !== chFeed) {
      d.trace?.('eu.feed', { was: chFeed, now: feed });
      chFeed = feed;
    }
    return answer;
  };
  const vias = viasOf(chFeed);
  let answer: unknown;
  try {
    answer = await ask(vias);
  } catch (e) {
    if (!vias.length) throw e;
    // A via Transitous does not know: perhaps the Swiss feed renamed. Asked without, which says
    // the feed's name now; with a new one, once more with the vias by it.
    d.trace?.('eu.plan.retry', { vias: vias.length });
    const was = vias.join();
    answer = await ask([]);
    const again = viasOf(chFeed);
    if (again.length && again.join() !== was) {
      try {
        answer = await ask(again);
      } catch {
        d.trace?.('eu.plan.retry', { vias: again.length, without: true });
      }
    }
  }
  return pinEnds(euConnections(answer, 0, localBySloid(d.index)), q, where);
}
