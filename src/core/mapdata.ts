// GeoJSON for the map screen: the tour's stops, its rides (track geometry when OJP sent it,
// else straight lines through the calls) and the highlights of its templates.
import { linesOf, markRings } from './line';
import type { Lang } from '../i18n';
import { highlightName, type RouteTemplate } from './data';
import type { Connection, LatLon, Tour } from './model';
import { stopKey } from './stops';

type Pos = [number, number];
interface Feature<G> {
  type: 'Feature';
  geometry: G;
  properties: Record<string, string | number | boolean>;
}
export interface Collection<G> {
  type: 'FeatureCollection';
  features: Feature<G>[];
}
type Point = { type: 'Point'; coordinates: Pos };
type Line = { type: 'LineString'; coordinates: Pos[] };

const fc = <G>(features: Feature<G>[]): Collection<G> => ({ type: 'FeatureCollection', features });
const pos = (p: LatLon): Pos => [p.lon, p.lat];

export interface MapData {
  stops: Collection<Point>;
  lines: Collection<Line>;
  highlights: Collection<Point>;
  /** [west, south, east, north], or null with nothing to show. */
  bounds: [number, number, number, number] | null;
}

export function mapData(
  tour: Tour,
  chain: Connection[] | undefined,
  templates: RouteTemplate[],
  stop: (ref: string) => LatLon | undefined,
  lang: Lang = 'en',
): MapData {
  // Rings as the line has them (routes saved before 0.4.0 carry none).
  const stops = markRings(tour.waypoints).flatMap((w, i): Feature<Point>[] => {
    const p = stop(stopKey(w.stopRef));
    return p
      ? [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: pos(p) },
            properties: { name: w.name, kind: w.kind, i, ring: !!w.ring },
          },
        ]
      : [];
  });

  const lines: Feature<Line>[] = [];
  if (chain?.length) {
    chain.forEach((c, leg) =>
      c.sections.forEach((s, i) => {
        if (s.mode === 'walk') return;
        const coords =
          s.geometry && s.geometry.length > 1
            ? s.geometry
            : [s.from, ...s.intermediate, s.to].flatMap((x) => {
                const p = stop(stopKey(x.stopRef));
                return p ? [pos(p)] : [];
              });
        if (coords.length > 1)
          lines.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { leg, section: i, planned: true, exact: !!s.geometry },
          });
      }),
    );
  } else if (stops.length > 1) {
    lines.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: stops.map((f) => f.geometry.coordinates) },
      properties: { planned: false, exact: false },
    });
  }

  const ids = linesOf(tour.waypoints);
  const highlights = templates
    .filter((t) => ids.has(t.id))
    .flatMap((t) => t.highlights)
    .map((h): Feature<Point> => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
      properties: { name: highlightName(h, lang), id: h.id },
    }));

  const all = [
    ...stops.map((f) => f.geometry.coordinates),
    ...lines.flatMap((f) => f.geometry.coordinates),
    ...highlights.map((f) => f.geometry.coordinates),
  ];
  const bounds: MapData['bounds'] = all.length
    ? [
        Math.min(...all.map((p) => p[0])),
        Math.min(...all.map((p) => p[1])),
        Math.max(...all.map((p) => p[0])),
        Math.max(...all.map((p) => p[1])),
      ]
    : null;

  return { stops: fc(stops), lines: fc(lines), highlights: fc(highlights), bounds };
}

/**
 * The font the style's own labels use, for the map's added names: without one, MapLibre asks
 * for its default ("Open Sans Regular, Arial Unicode MS Regular"), which the tile host does not
 * have (404 on every label, seen in a debug log, 5 Nov 2026).
 */
export function styleFont(style: { layers?: readonly unknown[] }): string[] {
  for (const layer of style.layers ?? []) {
    const font = (layer as { layout?: { 'text-font'?: unknown } }).layout?.['text-font'];
    if (Array.isArray(font) && font.length && font.every((f) => typeof f === 'string'))
      return font as string[];
  }
  return ['Noto Sans Regular'];
}
