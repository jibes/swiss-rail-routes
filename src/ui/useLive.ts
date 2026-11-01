// The live state of a trip, ticking with the clock. Live calls for the train you are on (and
// the next one shortly before it leaves: journeysToWatch) every 2 min while the page is visible.
import { useEffect, useMemo, useState } from 'react';
import { journeysToWatch, liveState } from '../core/live';
import type { JourneyStatus } from '../core/ojp/journey';
import { journeyQueryOf } from '../core/ojp/request';
import type { Trip } from '../core/trip';
import { fetchJourney, ojpConfigured } from '../io/ojp';
import { refreshNow, useNow } from './useNow';

const POLL_MS = 120_000;

export function useLive(trip: Trip | undefined) {
  const now = useNow();
  const [status, setStatus] = useState<Map<string, JourneyStatus>>(new Map());
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const state = useMemo(
    () => (trip ? liveState(trip.chain.connections, now, status) : undefined),
    [trip, now, status],
  );
  const watch = state ? journeysToWatch(state, now).join('|') : '';

  useEffect(() => {
    if (!watch || !ojpConfigured()) return;
    const ctrl = new AbortController();
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const got = await Promise.all(
          watch.split('|').map(async (j) => {
            const q = journeyQueryOf(j);
            return q ? ([j, await fetchJourney(q, ctrl.signal)] as const) : null;
          }),
        );
        setStatus((old) => {
          const next = new Map(old);
          for (const g of got) if (g) next.set(g[0], g[1]);
          return next;
        });
        setFetchedAt(Date.now());
        setFailed(false);
      } catch {
        if (!ctrl.signal.aborted) setFailed(true);
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
