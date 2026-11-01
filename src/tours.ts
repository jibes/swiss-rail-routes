// Tours in memory, persisted to IndexedDB on every change (debounced).
import { create } from 'zustand';
import { newTour } from './core/edit';
import type { Tour } from './core/model';
import { loadTours, saveTours } from './io/tours';

interface ToursState {
  loaded: boolean;
  tours: Tour[];
  load: () => Promise<void>;
  create: (tour?: Omit<Tour, 'id'>) => string;
  update: (id: string, edit: (t: Tour) => Tour) => void;
  remove: (id: string) => void;
}

const newId = () => crypto.randomUUID();

/** Next Saturday, or today when it is one: day trips are mostly planned for the weekend. */
export function defaultDate(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d.toLocaleDateString('sv-SE');
}

let timer: ReturnType<typeof setTimeout> | undefined;
const persist = (tours: Tour[]) => {
  clearTimeout(timer);
  timer = setTimeout(() => void saveTours(tours), 300);
};

export const useTours = create<ToursState>()((set, get) => ({
  loaded: false,
  tours: [],
  load: async () => {
    if (get().loaded) return;
    set({ tours: await loadTours(), loaded: true });
  },
  create: (tour) => {
    const id = newId();
    const t: Tour = tour ? { ...tour, id } : newTour(id, defaultDate());
    const tours = [t, ...get().tours];
    set({ tours });
    persist(tours);
    return id;
  },
  update: (id, edit) => {
    const tours = get().tours.map((t) => (t.id === id ? edit(t) : t));
    set({ tours });
    persist(tours);
  },
  remove: (id) => {
    const tours = get().tours.filter((t) => t.id !== id);
    set({ tours });
    persist(tours);
  },
}));
