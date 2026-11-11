import { useSyncExternalStore } from 'react';

/** Wide enough for the list beside what it opens (0.61.0: two columns at most). */
export const TWO = 860;

const query = () =>
  typeof window === 'undefined' || !window.matchMedia
    ? null
    : window.matchMedia(`(min-width: ${TWO}px)`);

const subscribe = (cb: () => void) => {
  const q = query();
  q?.addEventListener('change', cb);
  return () => q?.removeEventListener('change', cb);
};

/** How many columns the screen has room for: 1 (a phone), 2 (list | trip). */
export function useColumns(): 1 | 2 {
  return useSyncExternalStore(subscribe, () => (query()?.matches ? 2 : 1));
}
