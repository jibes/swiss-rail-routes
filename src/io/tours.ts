// Saved tours and their last plan in IndexedDB. Keys follow srr.<name>.v<N>.
import { get, update } from 'idb-keyval';
import type { Tour } from '../core/model';
import { sanitiseTour } from '../core/tour';
import { dayOf } from '../core/trip';
import { savedList } from './listStore';
import type { PlanResult } from '../core/planner/plan';

const TOURS = 'srr.tours.v1';
const PLANS = 'srr.plans.v1';

/**
 * Your past trips (`srr.tours.v1`), each checked on the way in (an older or damaged version must
 * not crash the screens).
 */
export const toursList = savedList<Tour>(TOURS, (raw) => {
  if (!Array.isArray(raw)) return [];
  const today = dayOf(Date.now());
  return raw.flatMap((x) => {
    const t = sanitiseTour(x, today, 0);
    const id = (x as { id?: unknown })?.id;
    return t && typeof id === 'string' ? [{ ...t, id }] : [];
  });
});

export interface SavedPlan {
  /** JSON of the tour it was planned for; a changed tour makes it stale. */
  tourJson: string;
  at: string;
  result: PlanResult;
}
/** Saved plans by trip id; storage that cannot be read gives none (they are a cache). */
export async function loadPlans(): Promise<Record<string, SavedPlan>> {
  try {
    return (await get<Record<string, SavedPlan>>(PLANS)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Keeps one trip's plan and drops those of trips that no longer exist, in one transaction: two
 * plans finishing at once both stay.
 */
export function savePlan(id: string, plan: SavedPlan, trips: Set<string>): Promise<void> {
  return update<Record<string, SavedPlan>>(PLANS, (all = {}) => ({
    ...Object.fromEntries(Object.entries(all).filter(([k]) => trips.has(k))),
    [id]: plan,
  })).catch(() => undefined);
}
