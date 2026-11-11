// Where each station's name goes on the map (audit, 11 Nov 2026): kept apart from the others and,
// where it can be, off the route's line, the weather's icons and other stations (`placeLabels`).
import type * as maplibregl from 'maplibre-gl';
import { DOT_GAP, placeLabels, type Box, type Side } from '../core/mapLabels';
import type { WeatherMap } from '../core/weatherMap';

type At = [number, number];

export interface MapName {
  el: HTMLElement;
  marker: maplibregl.Marker;
  at: At;
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

export function placeNames(
  map: maplibregl.Map,
  names: MapName[],
  lines: Lines,
  dots: At[],
  weather: WeatherMap | null,
) {
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
  // As `addWeatherLayers` draws them: a column 12 × 42 px standing 10 px above its station from
  // zoom 7, the sky 32 px square 8 px right of its stop from zoom 8.
  const zoom = map.getZoom();
  if (weather && zoom >= 7)
    for (const f of weather.rain.features) {
      const [x, y] = pt(f.geometry.coordinates as At);
      boxes.push({ x: x - 6, y: y - 52, w: 12, h: 42 });
    }
  if (weather && zoom >= 8)
    for (const f of weather.sky.features) {
      const [x, y] = pt(f.geometry.coordinates as At);
      boxes.push({ x: x + 8, y: y - 16, w: 32, h: 32 });
    }
  const labels = names.map((n) => {
    const [x, y] = pt(n.at);
    return { x, y, w: n.el.offsetWidth, h: n.el.offsetHeight };
  });
  const sides = placeLabels(labels, { boxes, lines: runs });
  names.forEach((n, i) => {
    const side = sides[i];
    n.el.style.visibility = side ? '' : 'hidden';
    if (side) n.el.dataset.side = side;
    if (side) n.marker.setOffset(offsetOf(side, labels[i]!.w, labels[i]!.h));
  });
}
