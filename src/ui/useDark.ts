import { useSyncExternalStore } from 'react';

const query = () => window.matchMedia?.('(prefers-color-scheme: dark)');

/** Whether the device is dark (the app's theme follows it): the map's style follows too. */
export function useDark(): boolean {
  return useSyncExternalStore(
    (on) => {
      const q = query();
      q?.addEventListener('change', on);
      return () => q?.removeEventListener('change', on);
    },
    () => !!query()?.matches,
    () => false,
  );
}
