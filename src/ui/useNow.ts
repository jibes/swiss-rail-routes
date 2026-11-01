// One shared clock for the UI: the time in ms, ticking every 15 s while anything listens.
// Render code must not read Date.now() itself (React purity); it subscribes here.
import { useSyncExternalStore } from 'react';

const TICK_MS = 15_000;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer)
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  return () => {
    listeners.delete(cb);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );

/** Re-reads the clock now (on mount, on returning to the app). */
export function refreshNow() {
  now = Date.now();
  listeners.forEach((l) => l());
}
