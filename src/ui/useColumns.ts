import { useSyncExternalStore } from 'react';

/** Wide enough for the trip beside its map; and for the list beside both. */
export const TWO = 860;
export const THREE = 1200;

const queries = () =>
  typeof window === 'undefined' || !window.matchMedia
    ? null
    : [window.matchMedia(`(min-width: ${TWO}px)`), window.matchMedia(`(min-width: ${THREE}px)`)];

const subscribe = (cb: () => void) => {
  const qs = queries();
  qs?.forEach((q) => q.addEventListener('change', cb));
  return () => qs?.forEach((q) => q.removeEventListener('change', cb));
};

/** How many columns the screen has room for: 1 (a phone), 2 (trip | map), 3 (list | trip | map). */
export function useColumns(): 1 | 2 | 3 {
  return useSyncExternalStore(subscribe, () => {
    const qs = queries();
    return qs?.[1]!.matches ? 3 : qs?.[0]!.matches ? 2 : 1;
  });
}
