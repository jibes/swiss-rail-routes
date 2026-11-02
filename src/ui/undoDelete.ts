// The trip just deleted, for a few seconds: the list offers Undo (0.5.2).
import { create } from 'zustand';
import type { Trip } from '../core/trip';

export const UNDO_MS = 6000;

export const useDeleted = create<{ trip: Trip | null }>()(() => ({ trip: null }));

let timer: ReturnType<typeof setTimeout> | undefined;
export function rememberDeleted(trip: Trip) {
  clearTimeout(timer);
  useDeleted.setState({ trip });
  timer = setTimeout(() => useDeleted.setState({ trip: null }), UNDO_MS);
}
export function forgetDeleted() {
  clearTimeout(timer);
  useDeleted.setState({ trip: null });
}
