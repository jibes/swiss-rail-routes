// Where you are, as a height down the trip line (0.42.0): the weather stripe dims what is behind
// you to there and marks it in red, in step with the line's own marker (reported: the stripe
// dimmed row by row, a whole ride behind where the train was). Measured from the laid-out line:
// the station you wait at by its dot, a ride by where its rail turns from grey to red (`--fm`
// from `SyncHere` with its stops open, else `--f`, the share of the ride).
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useHereY(box: RefObject<HTMLOListElement | null>, on: boolean, tick: unknown) {
  const [y, setY] = useState<number | null>(null);
  useLayoutEffect(() => {
    const ol = box.current;
    if (!on || !ol) return;
    const measure = () => {
      const here = ol.querySelector<HTMLElement>(':scope > li.here');
      if (!here) return setY(null);
      const top = ol.getBoundingClientRect().top;
      if (here.classList.contains('station')) {
        const dot = here.querySelector<HTMLElement>('.dot') ?? here;
        const b = dot.getBoundingClientRect();
        return setY(Math.round(b.top + b.height / 2 - top));
      }
      const rail = here.querySelector<HTMLElement>(':scope > .rail') ?? here;
      const b = rail.getBoundingClientRect();
      const fm = parseFloat(here.style.getPropertyValue('--fm'));
      const f = parseFloat(here.style.getPropertyValue('--f'));
      const at = Number.isFinite(fm) ? fm : Number.isFinite(f) ? (b.height * f) / 100 : 0;
      setY(Math.round(b.top + at - top));
    };
    // Once laid out (the marker's own measure runs in the same pass).
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [box, on, tick]);
  return on ? y : null;
}
