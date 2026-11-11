// Where each station's name goes on the map (audit, 11 Nov 2026): kept apart from the others and,
// where it can be, off the route's line and other stations (`placeLabels`).
import type * as maplibregl from 'maplibre-gl';
import { DOT_GAP, placeLabels, type Box, type Side } from '../core/mapLabels';

type At = [number, number];

export interface MapName {
  el: HTMLElement;
  marker: maplibregl.Marker;
  at: At;
  /** A change the plan chose: hidden rather than over the line or an icon. */
  optional?: boolean;
}

interface Lines {
  features: { geometry: { type: string; coordinates: unknown } }[];
}

/** A dot's reach, its ring included (radius 7 and stroke 3). */
const DOT = 9;

/** The marker's offset from its dot (anchored at its centre) for a side. */
function offsetOf(side: Side, w: number, h: number): [number, number] {
  if (side === 'below') return [0, DOT_GAP + h / 2];
  if (side === 'above') return [0, -DOT_GAP - h / 2];
  if (side === 'right') return [DOT_GAP + w / 2, 0];
  return [-DOT_GAP - w / 2, 0];
}

export function placeNames(map: maplibregl.Map, names: MapName[], lines: Lines, dots: At[]) {
  const pt = (c: At): At => {
    const p = map.project(c);
    return [p.x, p.y];
  };
  const runs: At[][] = [];
  for (const f of lines.features) {
    const g = f.geometry;
    if (g.type === 'LineString') runs.push((g.coordinates as At[]).map(pt));
    if (g.type === 'MultiLineString') for (const r of g.coordinates as At[][]) runs.push(r.map(pt));
  }
  const boxes: Box[] = dots.map((c) => {
    const [x, y] = pt(c);
    return { x: x - DOT, y: y - DOT, w: 2 * DOT, h: 2 * DOT };
  });
  const labels = names.map((n) => {
    const [x, y] = pt(n.at);
    return { x, y, w: n.el.offsetWidth, h: n.el.offsetHeight, optional: n.optional };
  });
  const c = map.getContainer();
  const view = { x: 0, y: 0, w: c.clientWidth, h: c.clientHeight };
  const sides = placeLabels(labels, { boxes, lines: runs, view });
  names.forEach((n, i) => {
    const side = sides[i];
    n.el.style.visibility = side ? '' : 'hidden';
    if (side) n.el.dataset.side = side;
    if (side) n.marker.setOffset(offsetOf(side, labels[i]!.w, labels[i]!.h));
  });
}
