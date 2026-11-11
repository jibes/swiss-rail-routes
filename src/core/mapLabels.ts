// The map's station names are HTML markers (no style fonts, so the plain ground has them too),
// which MapLibre does not keep apart: zoomed out they lay on each other ("Zürich HBIB", review of
// 11 Nov 2026). Pure: which to show, greedily in the order given (the most wanted first).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Breathing room between two names, in pixels. */
export const LABEL_GAP = 4;

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** For each box, in order of priority, whether it is shown: none lies over one shown before. */
export function placeLabels(boxes: Box[], gap = LABEL_GAP): boolean[] {
  const shown: Box[] = [];
  return boxes.map((b) => {
    if (shown.some((s) => overlaps(s, b, gap))) return false;
    shown.push(b);
    return true;
  });
}

/** A station's name as the map says it: a stop's ", Bahnhof" (and its kin) left off. */
export const mapName = (name: string) =>
  name.replace(/,\s*(Bahnhof|Bahnhof Süd|Gare|Stazione|Staziun|Stazion)$/i, '');
