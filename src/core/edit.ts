// A tour's start and end kinds, a new tour, and old route links' template tokens (`@tpl`).
// The rest of the old builder's edits live with the tests that build tours (tests/helpers).
import type { Tour, Waypoint, WaypointKind } from './model';

/** First waypoint is `start`, last is `end`; inner ones keep their kind but never start/end. */
export function normalise(waypoints: Waypoint[]): Waypoint[] {
  return waypoints.map((w, i, all) => {
    const kind: WaypointKind =
      i === 0
        ? 'start'
        : i === all.length - 1 && all.length > 1
          ? 'end'
          : w.kind === 'start' || w.kind === 'end'
            ? 'via'
            : w.kind;
    const stays = kind === 'stop' || kind === 'turnaround';
    const dwellMin = stays ? w.dwellMin : 0;
    // No stay, no time it ends by (reported in review: a hidden stay until next morning kept a
    // day trip's late returns once its station became the end).
    const timed = !stays && w.stayUntil;
    if (kind === w.kind && dwellMin === w.dwellMin && !timed) return w;
    const { stayUntil: _u, ...plain } = w;
    return { ...(stays ? w : plain), kind, dwellMin };
  });
}

const withWaypoints = (tour: Tour, waypoints: Waypoint[]): Tour => ({
  ...tour,
  waypoints: normalise(waypoints),
});

export function newTour(
  id: string,
  date: string,
  start?: Pick<Waypoint, 'stopRef' | 'name'>,
): Tour {
  return {
    id,
    name: '',
    date,
    anchor: { departAt: '08:00' },
    ticket: 'GA',
    travelClass: 2,
    waypoints: start ? [{ ...start, kind: 'start', dwellMin: 0 }] : [],
    schema: 1,
  };
}

const isClosed = (tour: Tour) =>
  tour.waypoints.length > 1 && tour.waypoints[0]!.stopRef === tour.waypoints.at(-1)!.stopRef;

/**
 * Inserts a route template: its first stop (unless the tour is already there), its must-pass
 * stops and its last stop, all tagged with the template so the planner applies its rules.
 * `reversed` runs it end to start. Inserted before the end of a round trip, else appended.
 */
export function insertTemplate(
  tour: Tour,
  template: { id: string; chain: { ref: string; name: string }[]; mustPass: string[] },
  reversed = false,
): Tour {
  const chain = reversed ? [...template.chain].reverse() : template.chain;
  const must = new Set(template.mustPass);
  const picked = chain.filter((s, i) => i === 0 || i === chain.length - 1 || must.has(s.ref));
  const list = [...tour.waypoints];
  const at = isClosed(tour) ? list.length - 1 : list.length;
  const before = list[at - 1];
  const add = picked
    .filter((s, i) => !(i === 0 && before?.stopRef === s.ref))
    .map((s): Waypoint => ({
      stopRef: s.ref,
      name: s.name,
      kind: 'via',
      dwellMin: 0,
      templateId: template.id,
    }));
  if (before && before.stopRef === picked[0]?.ref)
    list[at - 1] = { ...before, templateId: template.id };
  list.splice(at, 0, ...add);
  return withWaypoints(tour, list);
}
