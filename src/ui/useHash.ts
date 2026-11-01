import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** Current hash route without the leading `#`, e.g. `/tour/abc`. */
export const useHash = () =>
  useSyncExternalStore(subscribe, () => window.location.hash.slice(1) || '/');

export const go = (path: string) => {
  window.location.hash = path;
};
