// Drag to reorder a vertical list by a grip: the row follows the finger, the rows it passes
// make room, the drop calls `onMove(from, to)`. Arrow keys on the grip move by one.
import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

interface Drag {
  from: number;
  over: number;
  dy: number;
  startY: number;
  rects: DOMRect[];
}

export function useDragList(onMove: (from: number, to: number) => void) {
  const [list, setList] = useState<HTMLOListElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Right after a drop the rows take their new places at once: no slide back from the gap.
  const [settling, setSettling] = useState(false);

  const rows = () => [...(list?.children ?? [])] as HTMLElement[];

  const overFor = (d: Drag, dy: number) => {
    const r = d.rects[d.from]!;
    const centre = r.top + r.height / 2 + dy;
    let over = d.from;
    d.rects.forEach((x, i) => {
      const mid = x.top + x.height / 2;
      if (i > d.from && centre > mid) over = Math.max(over, i);
      if (i < d.from && centre < mid) over = Math.min(over, i);
    });
    return over;
  };

  const grip = (i: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); // no text selection while dragging with a mouse
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        from: i,
        over: i,
        dy: 0,
        startY: e.clientY,
        rects: rows().map((el) => el.getBoundingClientRect()),
      });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!drag || drag.from !== i) return;
      const dy = e.clientY - drag.startY;
      setDrag({ ...drag, dy, over: overFor(drag, dy) });
    },
    onPointerUp: () => {
      if (drag && drag.from === i && drag.over !== drag.from) {
        setSettling(true);
        onMove(drag.from, drag.over);
        requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
      }
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
      if (to === null) return;
      e.preventDefault();
      if (to >= 0 && to < rows().length) onMove(i, to);
    },
  });

  /** Style for row i while a drag is on: the dragged row follows, the others make room. */
  const rowStyle = (i: number): CSSProperties | undefined => {
    if (!drag) return settling ? { transition: 'none' } : undefined;
    const h = drag.rects[drag.from]!.height;
    if (i === drag.from)
      return { transform: `translateY(${drag.dy}px)`, zIndex: 2, transition: 'none' };
    if (drag.over > drag.from && i > drag.from && i <= drag.over)
      return { transform: `translateY(${-h}px)` };
    if (drag.over < drag.from && i >= drag.over && i < drag.from)
      return { transform: `translateY(${h}px)` };
    return { transform: 'none' };
  };

  return { list, listRef: setList, grip, rowStyle, dragging: drag?.from ?? null };
}
