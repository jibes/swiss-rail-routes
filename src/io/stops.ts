// Loads the bundled stop index once (precached by the service worker).
import { createStopSearch, type StopIndexFile, type StopSearch } from '../core/stops';

let pending: Promise<StopSearch> | undefined;

export function stopSearch(): Promise<StopSearch> {
  pending ??= fetch(`${import.meta.env.BASE_URL}data/stops.v1.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`stops ${r.status}`);
      return r.json() as Promise<StopIndexFile>;
    })
    .then(createStopSearch)
    .catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
