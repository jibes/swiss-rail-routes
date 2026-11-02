import { Fragment } from 'react';
import type { Tour } from '../core/model';
import { markRings } from '../core/line';

/** A route as a tiny line: solid dots where you get off, rings where you ride through.
 * Dots and line segments in a row, so the dots stay round however wide the line is. */
export function MiniLine({ tour }: { tour: Pick<Tour, 'waypoints'> }) {
  const pts = markRings(tour.waypoints);
  return (
    <span className="mini-line" aria-hidden="true">
      {pts.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && <i />}
          <b className={w.kind === 'via' ? 'via' : undefined} />
        </Fragment>
      ))}
    </span>
  );
}
