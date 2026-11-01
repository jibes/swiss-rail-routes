// Saved tours and their last plan in IndexedDB. Keys follow srr.<name>.v<N>.
import { get, set } from 'idb-keyval';
import type { Tour } from '../core/model';
import { sanitiseTour } from '../core/tour';
import type { PlanResult } from '../core/planner/plan';

const TOURS = 'srr.tours.v1';
const PLANS = 'srr.plans.v1';

/**
 * Saved routes, each checked on the way in (an older or damaged version must not crash the
 * screens). Storage that cannot be opened (blocked site data) gives none: the app still runs.
 */
export async function loadTours(): Promise<Tour[]> {
  let raw: unknown;
  try {
    raw = await get(TOURS);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const today = new Date().toLocaleDateString('sv-SE');
  return raw.flatMap((x) => {
    const t = sanitiseTour(x, today, 0);
    const id = (x as { id?: unknown })?.id;
    return t && typeof id === 'string' ? [{ ...t, id }] : [];
  });
}
export const saveTours = (tours: Tour[]) => set(TOURS, tours);

export interface SavedPlan {
  /** JSON of the tour it was planned for; a changed tour makes it stale. */
  tourJson: string;
  at: string;
  result: PlanResult;
}
export const loadPlans = async () => (await get<Record<string, SavedPlan>>(PLANS)) ?? {};
export const savePlans = (plans: Record<string, SavedPlan>) => set(PLANS, plans);
