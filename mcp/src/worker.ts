// The app's core talking to the OJP Worker from Node: a call budget, an in-memory cache, and
// answers read without their tracks. Nothing here is written to disk or logged by content.
import type { Connection } from '../../src/core/model';
import { parseJourney, UnknownJourneyError, type JourneyStatus } from '../../src/core/ojp/journey';
import { parseTrips } from '../../src/core/ojp/parse';
import { parseDepartures, type Departures } from '../../src/core/ojp/departures';
import type { DeparturesQuery, JourneyQuery, TripQuery } from '../../src/core/ojp/request';
import { dayOf, zurichTime } from '../../src/core/trip';

/** Said to the caller: it can try again, so it is not the service being down. */
export class BusyError extends Error {
  constructor(readonly retryAfterS: number) {
    super(`timetable service busy, try again in ${retryAfterS} s`);
  }
}

export class UnavailableError extends Error {
  constructor() {
    super('timetable service unavailable');
  }
}

/**
 * The Worker allows 120 uncached calls a minute per IP, and everything here shares one IP. Some
 * room stays for retries. A call waits its turn, in order; past `maxWaitMs` it is refused.
 */
export class CallBudget {
  private slots: number[] = [];
  constructor(
    private readonly perMinute = 100,
    private readonly maxWaitMs = 20_000,
    private readonly now: () => number = Date.now,
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async take(): Promise<void> {
    const now = this.now();
    this.slots = this.slots.filter((t) => t > now - 60_000);
    const blocker = this.slots.at(-this.perMinute);
    const at = blocker === undefined ? now : Math.max(now, blocker + 60_000);
    if (at - now > this.maxWaitMs) throw new BusyError(Math.ceil((at - now) / 1000));
    this.slots.push(at);
    if (at > now) await this.sleep(at - now);
  }
}

const OPEN = /<(?:\w+:)?LinkProjection>/;
const CLOSE = /<\/(?:\w+:)?LinkProjection>/;

/**
 * An answer's text without its tracks, dropped while it downloads: they are 90 % of the 4–7 MB
 * of an answer, nothing here uses them, and the container has 256 MB.
 */
export async function withoutTracks(res: Response): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let inside = false;
  const keep: string[] = [];
  const pump = (end: boolean) => {
    for (;;) {
      const m = (inside ? CLOSE : OPEN).exec(buffer);
      if (m) {
        if (!inside) keep.push(buffer.slice(0, m.index));
        buffer = buffer.slice(m.index + m[0].length);
        inside = !inside;
        continue;
      }
      // A tag may lie across two chunks: hold back from the last '<'.
      const lt = end ? -1 : buffer.lastIndexOf('<');
      const cut = lt >= 0 && buffer.length - lt < 64 ? lt : buffer.length;
      if (!inside) keep.push(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
      return;
    }
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    pump(false);
  }
  buffer += decoder.decode();
  pump(true);
  return keep.join('');
}

const TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 10_000;
const TRAVEL_DAY_MS = 15 * 60_000;
const CACHE_ENTRIES = 300;

export interface WorkerOptions {
  url: string;
  fetch?: typeof fetch;
  now?: () => number;
  budget?: CallBudget;
  sleep?: (ms: number) => Promise<unknown>;
}

export interface Timetable {
  trips: (q: TripQuery) => Promise<Connection[]>;
  journey: (q: JourneyQuery) => Promise<JourneyStatus>;
  /** A stop's trains with their onward stops (reachable_from). */
  departures?: (q: DeparturesQuery) => Promise<Departures>;
}

export function createWorker(o: WorkerOptions): Timetable {
  const base = o.url.replace(/[/]$/, '');
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const budget = o.budget ?? new CallBudget();
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cache = new Map<string, { until: number; answer: Connection[] }>();
  const asking = new Map<string, Promise<Connection[]>>();

  const post = async (path: string, body: unknown): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      await budget.take();
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new UnavailableError();
      }
      if (res.ok) return res;
      void res.body?.cancel();
      // The Worker's limit (429), or OJP's quota passed on as 503.
      if (res.status !== 429 && res.status !== 503) throw new UnavailableError();
      const after = Number(res.headers.get('Retry-After'));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 3000 * (attempt + 1);
      if (attempt >= 2 || wait > MAX_RETRY_WAIT_MS) throw new BusyError(Math.ceil(wait / 1000));
      await sleep(wait);
    }
  };

  /** On the travel day 15 minutes; for a later day until that day starts. */
  const keepUntil = (q: TripQuery) => {
    const date = q.time.slice(0, 10);
    const t = now();
    return date > dayOf(t)
      ? Math.max(zurichTime(date, '00:00'), t + TRAVEL_DAY_MS)
      : t + TRAVEL_DAY_MS;
  };

  const ask = async (q: TripQuery): Promise<Connection[]> => {
    const res = await post('/trip', q);
    try {
      return parseTrips(await withoutTracks(res));
    } catch {
      // An answer cut off, or OJP saying it failed ("no trip found" is an answer, not this).
      throw new UnavailableError();
    }
  };

  return {
    trips: (q) => {
      const key = JSON.stringify(q);
      const hit = cache.get(key);
      if (hit && hit.until > now()) {
        // Used last goes last: the map's first is the one dropped when full.
        cache.delete(key);
        cache.set(key, hit);
        return Promise.resolve(hit.answer);
      }
      cache.delete(key);
      const known = asking.get(key);
      if (known) return known;
      const p = ask(q)
        .then((answer) => {
          cache.set(key, { until: keepUntil(q), answer });
          if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
          return answer;
        })
        .finally(() => asking.delete(key));
      asking.set(key, p);
      return p;
    },
    departures: async (q) => {
      const res = await post('/departures', q);
      try {
        return parseDepartures(await res.text());
      } catch {
        throw new UnavailableError();
      }
    },
    journey: async (q) => {
      const res = await post('/journey', q);
      try {
        return parseJourney(await res.text());
      } catch (e) {
        // No such train that day is an answer (retest round 3: it was said as an outage).
        if (e instanceof UnknownJourneyError) throw e;
        throw new UnavailableError();
      }
    },
  };
}
