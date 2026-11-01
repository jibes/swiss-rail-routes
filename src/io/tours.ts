// Saved tours and their last plan in IndexedDB. Keys follow srr.<name>.v<N>.
import { get, set } from 'idb-keyval';
import type { Tour } from '../core/model';
import type { PlanResult } from '../core/planner/plan';

const TOURS = 'srr.tours.v1';
const PLANS = 'srr.plans.v1';

export const loadTours = async (): Promise<Tour[]> => (await get<Tour[]>(TOURS)) ?? [];
export const saveTours = (tours: Tour[]) => set(TOURS, tours);

export interface SavedPlan {
  /** JSON of the tour it was planned for; a changed tour makes it stale. */
  tourJson: string;
  at: string;
  result: PlanResult;
}
export const loadPlans = async () => (await get<Record<string, SavedPlan>>(PLANS)) ?? {};
export const savePlans = (plans: Record<string, SavedPlan>) => set(PLANS, plans);
