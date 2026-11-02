// Map screen, loaded lazily (MapLibre is the largest dependency).
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { mapData } from '../core/mapdata';
import type { Connection } from '../core/model';
import { stopSearch } from '../io/stops';
import { loadPlans } from '../io/tours';
import { useT } from '../store';
import { useTrips } from '../trips';
import { NotFound } from './NotFound';
import { TEMPLATES } from './TemplatePicker';
import { Icon } from './icons';
import { go } from './useHash';

maplibregl.setWorkerUrl(workerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const ACCENT = '#c0261b';

/** Without the tile host (offline, blocked): the route on a plain ground, still readable. */
const PLAIN: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#ecebe6' } }],
};

/** The map's style, fetched first: if it cannot be had, the plain one (and say so). */
async function styleOf(): Promise<maplibregl.StyleSpecification | null> {
  try {
    const res = await fetch(MAP_STYLE, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as maplibregl.StyleSpecification) : null;
  } catch {
    return null;
  }
}

/** A trip's map: its saved connections, or its last plan while it has none. */
export default function MapView({ id }: { id: string }) {
  const t = useT();
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const tour = trip?.route;
  const tripChain = trip?.chain?.connections;
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Some stretch has no track shape (drawn straight and dashed): say what dashed means.
  const [straight, setStraight] = useState(false);
  const json = tour ? JSON.stringify([tour, tripChain ?? null]) : '';

  useEffect(() => {
    if (!json || !box.current) return;
    const [current, savedChain] = JSON.parse(json) as [
      NonNullable<typeof tour>,
      Connection[] | null,
    ];
    const routeJson = JSON.stringify(current);
    let map: maplibregl.Map | undefined;
    let gone = false;
    (async () => {
      const [index, plans, style] = await Promise.all([stopSearch(), loadPlans(), styleOf()]);
      if (!style) setFailed(true);
      if (gone || !box.current) return;
      const saved = plans[id];
      const chain: Connection[] | undefined =
        savedChain ??
        (saved?.tourJson === routeJson ? saved.result.recommended?.connections : undefined);
      const d = mapData(current, chain, TEMPLATES, (r) => index.byRef(r));
      setStraight(d.lines.features.some((f) => !f.properties.exact));
      map = new maplibregl.Map({
        container: box.current,
        style: style ?? PLAIN,
        bounds: d.bounds ?? [5.9, 45.8, 10.5, 47.8],
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
      });
      map.on('error', () => setFailed(true));
      map.on('load', () => {
        if (!map) return;
        map.addSource('lines', { type: 'geojson', data: d.lines });
        map.addSource('stops', { type: 'geojson', data: d.stops });
        map.addSource('highlights', { type: 'geojson', data: d.highlights });
        map.addLayer({
          id: 'lines',
          type: 'line',
          source: 'lines',
          paint: {
            'line-color': ACCENT,
            'line-width': 4,
            'line-dasharray': ['case', ['get', 'exact'], ['literal', [1]], ['literal', [2, 2]]],
          },
        });
        map.addLayer({
          id: 'stops',
          type: 'circle',
          source: 'stops',
          paint: {
            'circle-radius': ['match', ['get', 'kind'], 'via', 4, 7],
            'circle-color': '#ffffff',
            'circle-stroke-color': ACCENT,
            'circle-stroke-width': 3,
          },
        });
        map.addLayer({
          id: 'highlights',
          type: 'circle',
          source: 'highlights',
          paint: {
            'circle-radius': 7,
            'circle-color': '#f2a900',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        // Names need the style's fonts: none on the plain ground (the highlights still show).
        if (style)
          map.addLayer({
            id: 'labels',
            type: 'symbol',
            source: 'highlights',
            layout: {
              'text-field': ['get', 'name'],
              'text-size': 12,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
            },
            paint: { 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
          });
      });
    })().catch(() => setFailed(true));
    return () => {
      gone = true;
      map?.remove();
    };
  }, [json, id]);

  if (!tour) return <NotFound />;
  return (
    <main className="mapview">
      <div className="map-bar">
        <button
          type="button"
          className="icon"
          aria-label={t('back')}
          // Up to the trip, as on every screen: the map may have been opened from a link.
          onClick={() => go(`/trip/${id}`)}
        >
          <Icon name="back" />
        </button>
      </div>
      {failed && (
        <p role="status" className="notice map-note">
          {t('mapOffline')}
        </p>
      )}
      {straight && !failed && <p className="notice map-note map-legend">{t('mapStraight')}</p>}
      <div ref={box} className="map" />
    </main>
  );
}
