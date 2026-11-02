// Loads the bundled stop index once (precached by the service worker).
import { createStopSearch, type StopIndexFile, type StopSearch } from '../core/stops';
import { log } from './log';

let pending: Promise<StopSearch> | undefined;

export function stopSearch(): Promise<StopSearch> {
  const t0 = performance.now();
  pending ??= fetch(`${import.meta.env.BASE_URL}data/stops.v1.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`stops ${r.status}`);
      return r.json() as Promise<StopIndexFile>;
    })
    .then((f) => {
      log('stops.load', { stops: f.rows.length, ms: Math.round(performance.now() - t0) });
      return createStopSearch(f);
    })
    .catch((e: unknown) => {
      log('stops.fail', { e });
      pending = undefined;
      throw e;
    });
  return pending;
}
