// The map's station names are HTML markers (no style fonts, so the plain ground has them too),
// which MapLibre does not keep apart: zoomed out they lay on each other ("Zürich HBIB", review of
// 11 Nov 2026). Pure: where each goes, greedily in the order given (the most wanted first): below
// its dot, else beside it or above, wherever it lies neither over a name placed before nor, if it
// can be helped, over the route's line, a weather icon or another station (audit, 11 Nov 2026).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A name to place: its station's dot (`x`, `y`, screen pixels) and the name's size. */
export interface Label {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a name had better not cover: boxes (icons, dots) and lines (each a run of points). */
export interface Obstacles {
  boxes: Box[];
  lines: [number, number][][];
}

export type Side = 'below' | 'right' | 'left' | 'above';

/** Tried in this order: below first, as before; above last, where a rain column stands. */
export const SIDES: Side[] = ['below', 'right', 'left', 'above'];

/** Breathing room between two names, in pixels. */
export const LABEL_GAP = 4;

/** From a dot's centre to its name's edge. */
export const DOT_GAP = 9;

/** Half the route line's width and a little room. */
const LINE_PAD = 3;

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Where a name on that side of its dot lies. */
export function boxAt(l: Label, side: Side): Box {
  const { x, y, w, h } = l;
  if (side === 'below') return { x: x - w / 2, y: y + DOT_GAP, w, h };
  if (side === 'above') return { x: x - w / 2, y: y - DOT_GAP - h, w, h };
  if (side === 'right') return { x: x + DOT_GAP, y: y - h / 2, w, h };
  return { x: x - DOT_GAP - w, y: y - h / 2, w, h };
}

/** Whether the segment a–b passes through the box (Liang–Barsky). */
function crosses(b: Box, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, ax - b.x],
    [dx, b.x + b.w - ax],
    [-dy, ay - b.y],
    [dy, b.y + b.h - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const onLine = (b: Box, line: [number, number][]) => {
  const p = { x: b.x - LINE_PAD, y: b.y - LINE_PAD, w: b.w + 2 * LINE_PAD, h: b.h + 2 * LINE_PAD };
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    if (Math.max(ax, bx) < p.x || Math.min(ax, bx) > p.x + p.w) continue;
    if (Math.max(ay, by) < p.y || Math.min(ay, by) > p.y + p.h) continue;
    if (crosses(p, ax, ay, bx, by)) return true;
  }
  return false;
};

/** How much a box covers: each icon or dot under it, and each line through it. */
const covers = (b: Box, o: Obstacles) =>
  o.boxes.filter((x) => overlaps(x, b, 0)).length + o.lines.filter((l) => onLine(b, l)).length;

/**
 * For each name, in order of priority, the side of its dot it goes (`null`: hidden): never over a
 * name placed before; of the sides left, the first covering nothing, else the one covering least.
 */
export function placeLabels(
  labels: Label[],
  obstacles: Obstacles = { boxes: [], lines: [] },
  gap = LABEL_GAP,
): (Side | null)[] {
  const shown: Box[] = [];
  return labels.map((l) => {
    let best: { side: Side; box: Box; n: number } | null = null;
    for (const side of SIDES) {
      const box = boxAt(l, side);
      if (shown.some((s) => overlaps(s, box, gap))) continue;
      const n = covers(box, obstacles);
      if (!best || n < best.n) best = { side, box, n };
      if (n === 0) break;
    }
    if (!best) return null;
    shown.push(best.box);
    return best.side;
  });
}

/** A station's name as the map says it: a stop's ", Bahnhof" (and its kin) left off. */
export const mapName = (name: string) =>
  name.replace(/,\s*(Bahnhof|Bahnhof Süd|Gare|Stazione|Staziun|Stazion)$/i, '');
