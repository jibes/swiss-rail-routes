import type { Tour } from '../core/model';
import { markRings } from '../core/line';

/** A route as a tiny line: solid dots where you get off, rings where you ride through. */
export function MiniLine({ tour }: { tour: Pick<Tour, 'waypoints'> }) {
  const pts = markRings(tour.waypoints);
  const n = Math.max(pts.length - 1, 1);
  return (
    <svg className="mini-line" viewBox="-8 -7 316 14" preserveAspectRatio="none" aria-hidden="true">
      {pts.length > 1 && <line x1="0" y1="0" x2="300" y2="0" />}
      {pts.map((w, i) =>
        w.kind === 'via' ? (
          <circle key={i} className="via" cx={(i / n) * 300} cy="0" r="3" />
        ) : (
          <circle key={i} cx={(i / n) * 300} cy="0" r="6" />
        ),
      )}
    </svg>
  );
}
