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
import { useTours } from '../tours';
import { NotFound } from './Builder';
import { TEMPLATES } from './TemplatePicker';
import { go } from './useHash';

maplibregl.setWorkerUrl(workerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const ACCENT = '#c0261b';

export default function MapView({ id }: { id: string }) {
  const t = useT();
  const tour = useTours((s) => s.tours.find((x) => x.id === id));
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const json = tour ? JSON.stringify(tour) : '';

  useEffect(() => {
    if (!json || !box.current) return;
    const current = JSON.parse(json) as NonNullable<typeof tour>;
    let map: maplibregl.Map | undefined;
    let gone = false;
    (async () => {
      const [index, plans] = await Promise.all([stopSearch(), loadPlans()]);
      if (gone || !box.current) return;
      const saved = plans[current.id];
      const chain: Connection[] | undefined =
        saved?.tourJson === json ? saved.result.recommended?.connections : undefined;
      const d = mapData(current, chain, TEMPLATES, (r) => index.byRef(r));
      map = new maplibregl.Map({
        container: box.current,
        style: MAP_STYLE,
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
  }, [json]);

  if (!tour) return <NotFound />;
  return (
    <main className="mapview">
      <header className="bar overlay">
        <button type="button" onClick={() => history.back()}>
          ← {t('back')}
        </button>
        <h1>{tour.name || t('untitled')}</h1>
        <button type="button" onClick={() => go(`/tour/${id}/plan`)}>
          {t('timeline')}
        </button>
      </header>
      {failed && (
        <p role="status" className="chip amber map-note">
          {t('mapOffline')}
        </p>
      )}
      <div ref={box} className="map" />
    </main>
  );
}
