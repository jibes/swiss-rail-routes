// Editing the rest of a trip under way (0.46.0): the draft of what lies ahead, one per trip, kept
// here so the trip screen and its map edit the same one (the map planner adds to it, the trip
// screen plans it and offers Update). Nothing is saved until Update; Discard drops it.
import { create } from 'zustand';
import type { LiveState } from '../core/live';
import type { Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import { remainingRoute, replanPoint, type ReplanPoint } from '../core/replan';
import type { PlannedTrip } from '../core/trip';

export interface RestDraft {
  /** Where you are: the rest starts there, fixed. */
  point: ReplanPoint;
  route: Tour;
  /** The rest as it was when editing began: nothing to update until it differs. */
  initial: string;
  /** The live state, time and trip version it began with: cut again at saving. */
  opened: { state: LiveState; now: number; version?: number };
  /** A connection chosen on the strip. */
  picked: PlannedChain | null;
  /** What to open first: a station of the rest, or the add sheet after its last. */
  focus?: { open?: number; add?: boolean };
}

interface Drafts {
  drafts: Record<string, RestDraft>;
  set: (id: string, d: RestDraft) => void;
  edit: (id: string, f: (r: Tour) => Tour) => void;
  pick: (id: string, c: PlannedChain | null) => void;
  discard: (id: string) => void;
}

export const useRestDrafts = create<Drafts>((set) => ({
  drafts: {},
  set: (id, d) => set((s) => ({ drafts: { ...s.drafts, [id]: d } })),
  edit: (id, f) =>
    set((s) => {
      const d = s.drafts[id];
      return d ? { drafts: { ...s.drafts, [id]: { ...d, route: f(d.route), picked: null } } } : s;
    }),
  pick: (id, c) =>
    set((s) => {
      const d = s.drafts[id];
      return d ? { drafts: { ...s.drafts, [id]: { ...d, picked: c } } } : s;
    }),
  discard: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.drafts;
      return { drafts: rest };
    }),
}));

/** The rest from where you are now, or null once there is none (arrived). */
export function restDraft(
  trip: PlannedTrip,
  state: LiveState,
  now: number,
  focus?: RestDraft['focus'],
): RestDraft | null {
  const point = replanPoint(trip, state, now);
  if (!point) return null;
  const route = remainingRoute(trip, point);
  return {
    point,
    route,
    initial: JSON.stringify(route),
    opened: { state, now, version: trip.version },
    picked: null,
    ...(focus ? { focus } : {}),
  };
}
