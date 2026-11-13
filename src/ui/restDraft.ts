// A change of a trip under way (0.62.0): the rest from where you are, with the change made on it,
// one per trip, planned by `RestApply` and then the trip's.
import { create } from 'zustand';
import type { LiveState } from '../core/live';
import type { Tour } from '../core/model';
import { remainingRoute, replanPoint, type ReplanPoint } from '../core/replan';
import type { PlannedTrip } from '../core/trip';

export interface RestDraft {
  /** Where you are: the rest starts there, fixed. */
  point: ReplanPoint;
  route: Tour;
  /** The live state, time and trip version it began with: cut again at saving. */
  opened: { state: LiveState; now: number; version?: number };
}

interface Drafts {
  drafts: Record<string, RestDraft>;
  set: (id: string, d: RestDraft) => void;
  discard: (id: string) => void;
}

export const useRestDrafts = create<Drafts>((set) => ({
  drafts: {},
  set: (id, d) => set((s) => ({ drafts: { ...s.drafts, [id]: d } })),
  discard: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.drafts;
      return { drafts: rest };
    }),
}));

/** The rest from where you are now, or null once there is none (arrived). */
export function restDraft(trip: PlannedTrip, state: LiveState, now: number): RestDraft | null {
  const point = replanPoint(trip, state, now);
  if (!point) return null;
  return {
    point,
    route: remainingRoute(trip, point),
    opened: { state, now, version: trip.version },
  };
}
