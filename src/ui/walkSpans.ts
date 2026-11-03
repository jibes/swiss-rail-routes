// A walk's dotted rail as one line, from the dot of the station before to the dot of the one
// after: drawn by the walk's row, it reaches into its neighbours by what is measured here
// (`--up`, `--down`), so its dots keep one spacing however tall the rows are (a note open).
import { useLayoutEffect, type RefObject } from 'react';

function place(list: HTMLElement) {
  for (const walk of list.querySelectorAll<HTMLElement>(':scope > li.ride.walk')) {
    const rail = walk.querySelector<HTMLElement>(':scope > .rail');
    const centre = (li: Element | null) => {
      const b = li?.querySelector(':scope > .rail .dot')?.getBoundingClientRect();
      return b && b.height ? b.top + b.height / 2 : undefined;
    };
    const up = centre(walk.previousElementSibling);
    const down = centre(walk.nextElementSibling);
    if (!rail || up === undefined || down === undefined) {
      walk.style.removeProperty('--up');
      walk.style.removeProperty('--down');
      continue;
    }
    const box = rail.getBoundingClientRect();
    walk.style.setProperty('--up', `${(box.top - up).toFixed(1)}px`);
    walk.style.setProperty('--down', `${(down - box.bottom).toFixed(1)}px`);
  }
}

/** Keeps every walk's dotted rail spanning dot to dot in the list `box`. */
export function useWalkSpans(box: RefObject<HTMLElement | null>) {
  // Every render: rows come and go with the plan; the observer catches what moves without one.
  useLayoutEffect(() => {
    if (box.current) place(box.current);
  });
  useLayoutEffect(() => {
    const list = box.current;
    if (!list) return;
    const ro = new ResizeObserver(() => place(list));
    ro.observe(list);
    return () => ro.disconnect();
  }, [box]);
}
