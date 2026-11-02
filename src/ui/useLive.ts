// The live state of a trip, ticking with the clock. Live calls for the train you are on (and
// the next one shortly before it leaves: journeysToWatch) every 2 min while the page is visible.
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { journeysToWatch, liveState } from '../core/live';
import type { JourneyStatus } from '../core/ojp/journey';
import { journeyQueryOf } from '../core/ojp/request';
import type { PlannedTrip as Trip } from '../core/trip';
import { fetchJourney, ojpConfigured } from '../io/ojp';
import { refreshNow, useNow } from './useNow';

const POLL_MS = 120_000;

/**
 * Live answers, shared by every screen (the trip, its edit screen): replanning from here must
 * see the same delays the trip screen showed.
 */
export const useLiveStatus = create<{
  status: Map<string, JourneyStatus>;
  /** The journeys `fetchedAt` and `failed` are about. */
  watch: string;
  fetchedAt: number | null;
  failed: boolean;
}>()(() => ({ status: new Map(), watch: '', fetchedAt: null, failed: false }));

/** `trip` only while it is under way; otherwise nothing is polled. */
export function useLive(trip: Trip | undefined) {
  const now = useNow();
  const { status, fetchedAt, failed } = useLiveStatus();
  const state = useMemo(
    () => (trip ? liveState(trip.chain.connections, now, status) : undefined),
    [trip, now, status],
  );
  const watch = state ? journeysToWatch(state, now).join('|') : '';

  useEffect(() => {
    // "Live at" and "not updated" describe the trains watched now, not an earlier trip's.
    if (useLiveStatus.getState().watch !== watch)
      useLiveStatus.setState({ watch, fetchedAt: null, failed: false });
    if (!watch || !ojpConfigured()) return;
    const ctrl = new AbortController();
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        // One train's answer failing does not throw away the other's.
        const settled = await Promise.allSettled(
          watch.split('|').map(async (j) => {
            const q = journeyQueryOf(j);
            return q ? ([j, await fetchJourney(q, ctrl.signal)] as const) : null;
          }),
        );
        if (settled.every((x) => x.status === 'rejected')) throw new Error('live');
        const got = settled.map((x) => (x.status === 'fulfilled' ? x.value : null));
        const next = new Map(useLiveStatus.getState().status);
        for (const g of got) if (g) next.set(g[0], g[1]);
        useLiveStatus.setState({ status: next, fetchedAt: Date.now(), failed: false });
      } catch {
        if (!ctrl.signal.aborted) useLiveStatus.setState({ failed: true });
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshNow();
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [watch]);

  return { state, now, fetchedAt, failed };
}
