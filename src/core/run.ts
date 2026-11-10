// A train's whole run (0.45.0): every stop it calls at from where it starts to where it ends,
// from its live answer (OJP TripInfo: PreviousCall and OnwardCall), each marked as the part you
// ride or not. Pure.
import type { LiveCall } from './ojp/journey';
import type { Section } from './model';
import { stopKey } from './stops';

export interface RunStop {
  name: string;
  /** Timetabled, ISO. */
  arr?: string;
  dep?: string;
  /** Inside the part you ride (its ends included). */
  yours: boolean;
}

/**
 * The run with your part marked: from where you board to where you get off, by stop and, as a
 * train may pass a station twice (a loop), the first boarding and the alighting after it.
 */
export function wholeRun(calls: LiveCall[], s: Pick<Section, 'from' | 'to'>): RunStop[] {
  const from = stopKey(s.from.stopRef);
  const to = stopKey(s.to.stopRef);
  const on = calls.findIndex((c) => c.key === from);
  const off = on < 0 ? -1 : calls.findIndex((c, i) => i > on && c.key === to);
  return calls.map((c, i) => ({
    name: c.name,
    ...(c.arr ? { arr: c.arr } : {}),
    ...(c.dep ? { dep: c.dep } : {}),
    yours: on >= 0 && off >= 0 && i >= on && i <= off,
  }));
}
