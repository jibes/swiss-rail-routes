import { create } from 'zustand';

/** The station the pointer is on in the trip's line (desktop columns): ringed on the map beside. */
export const useFocusStop = create<{ key: string | null; set: (key: string | null) => void }>(
  (set) => ({ key: null, set: (key) => set({ key }) }),
);
