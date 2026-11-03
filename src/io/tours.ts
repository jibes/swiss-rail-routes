// Saved tours and their last plan in IndexedDB. Keys follow srr.<name>.v<N>.
import { get, update } from 'idb-keyval';
import type { Leg, Tour } from '../core/model';
import { sanitiseTour } from '../core/tour';
import { dayOf } from '../core/trip';
import { savedList } from './listStore';
import type { PlanResult, PlannedChain } from '../core/planner/plan';

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
    // What this version does not know stays (a field a newer version added, synced from
    // another device): read, saved and hashed as it came, so it is neither lost nor an edit.
    return t && typeof id === 'string' ? [{ ...(x as object), ...t, id }] : [];
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

const OPTIONS = 'srr.options.v1';

/** Connections loaded with the strip's arrows, kept with the route they are for. */
export interface KeptOptions {
  /** `optionsKey` of the route. */
  key: string;
  list: { c: PlannedChain; legs: Leg[] }[];
}

/** Options not left yet: those gone are of no use to choose. */
const ahead = (list: KeptOptions['list'], now: number) =>
  list.filter((o) => Date.parse(o.c.dep) > now);

/** The options loaded for trip `id` and this route, those still ahead. */
export async function loadOptions(id: string, key: string): Promise<KeptOptions['list']> {
  try {
    const kept = (await get<Record<string, KeptOptions>>(OPTIONS))?.[id];
    return kept?.key === key && Array.isArray(kept.list) ? ahead(kept.list, Date.now()) : [];
  } catch {
    return [];
  }
}

/** Keeps them, and drops those of trips gone or with nothing left ahead (one transaction). */
export function saveOptions(
  id: string,
  kept: KeptOptions,
  trips: Set<string>,
  now = Date.now(),
): Promise<void> {
  return update<Record<string, KeptOptions>>(OPTIONS, (all = {}) => {
    const next: Record<string, KeptOptions> = {};
    for (const [k, v] of Object.entries({ ...all, [id]: kept })) {
      const list = trips.has(k) && Array.isArray(v?.list) ? ahead(v.list, now) : [];
      if (list.length) next[k] = { key: v.key, list };
    }
    return next;
  }).catch(() => undefined);
}
