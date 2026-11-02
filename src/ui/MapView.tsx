// Map screen, loaded lazily (MapLibre is the largest dependency).
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expectedArrival } from '../core/live';
import { mapData } from '../core/mapdata';
import type { Connection } from '../core/model';
import { accuracyArea, estimatedPosition, shownPosition } from '../core/position';
import { stopKey } from '../core/stops';
import { isPlanned, tripStatus } from '../core/trip';
import { stopSearch } from '../io/stops';
import { loadPlans } from '../io/tours';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { NotFound } from './NotFound';
import { TEMPLATES } from './TemplatePicker';
import { Icon } from './icons';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { canLocate, useLocation } from './useLocation';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';

maplibregl.setWorkerUrl(workerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const ACCENT = '#c0261b';
const LOCATION = '#1a73e8';

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
  // The map, once it can take what is drawn on it after loading.
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  // A move of the map: whether the location is in view is read from it.
  const [, setMoved] = useState(0);

  // Where you are: by the time while the trip is under way, by the device when asked to.
  const now = useNow();
  const liveStatus = useLiveStatus((s) => s.status);
  const status = trip
    ? tripStatus(
        trip,
        now,
        trip.chain ? expectedArrival(trip.chain.connections, liveStatus) : undefined,
      )
    : 'upcoming';
  const { state } = useLive(trip && status === 'live' && isPlanned(trip) ? trip : undefined);
  const index = useStopIndex();
  const estimate = useMemo(
    () => (state && index ? estimatedPosition(state, (k) => index.byRef(stopKey(k))) : null),
    [state, index],
  );
  const locating = usePrefs((s) => s.location);
  const setLocating = usePrefs((s) => s.setLocation);
  // Refused: off again, so the next visit does not ask or fail again; said until tapped.
  const [denied, setDenied] = useState(false);
  const onDenied = useCallback(() => {
    setDenied(true);
    setLocating(false);
  }, [setLocating]);
  const fix = useLocation(locating, onDenied);
  const shown = shownPosition(estimate, fix, now);
  const here: [number, number] | null = !shown
    ? null
    : shown.source === 'location'
      ? [shown.fix.lon, shown.fix.lat]
      : shown.estimate.pos;
  const source = shown?.source;
  const hereLabel = t(source === 'location' ? 'mapYou' : 'mapEstimate');
  // Never moved to the location: tiles for that place would tell the tile host where you are.
  const away = !!map && source === 'location' && !map.getBounds().contains(here!);

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
      map.on('moveend', () => setMoved((n) => n + 1));
      map.on('load', () => {
        if (!map) return;
        map.addSource('lines', { type: 'geojson', data: d.lines });
        map.addSource('stops', { type: 'geojson', data: d.stops });
        map.addSource('highlights', { type: 'geojson', data: d.highlights });
        map.addSource('accuracy', { type: 'geojson', data: accuracyArea(null) });
        map.addLayer({
          id: 'accuracy',
          type: 'fill',
          source: 'accuracy',
          paint: { 'fill-color': LOCATION, 'fill-opacity': 0.15 },
        });
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
        setMap(map);
      });
    })().catch(() => setFailed(true));
    return () => {
      gone = true;
      setMap(null);
      map?.remove();
    };
  }, [json, id]);

  // The marker: one, its look by what it is from (made anew only when that changes).
  const marker = useRef<maplibregl.Marker | null>(null);
  const placed = !!here;
  useEffect(() => {
    if (!map || !placed || !source) return;
    const el = document.createElement('div');
    el.className = `map-here ${source}`;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', hereLabel);
    const m = new maplibregl.Marker({ element: el }).setLngLat([0, 0]).addTo(map);
    marker.current = m;
    return () => {
      marker.current = null;
      m.remove();
    };
  }, [map, placed, source, hereLabel]);
  const [lon, lat] = here ?? [0, 0];
  useEffect(() => {
    marker.current?.setLngLat([lon, lat]);
  }, [map, placed, source, hereLabel, lon, lat]);
  const shownFix = shown?.source === 'location' ? shown.fix : null;
  useEffect(() => {
    map?.getSource<maplibregl.GeoJSONSource>('accuracy')?.setData(accuracyArea(shownFix));
  }, [map, shownFix]);

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
        {canLocate() && (
          <button
            type="button"
            className={locating ? 'icon locating' : 'icon'}
            aria-label={t('mapLocate')}
            aria-pressed={locating}
            onClick={() => {
              setDenied(false);
              setLocating(!locating);
            }}
          >
            <Icon name="locate" />
          </button>
        )}
      </div>
      {failed && (
        <p role="status" className="notice map-note">
          {t('mapOffline')}
        </p>
      )}
      <div className="map-notes">
        {denied && (
          <p role="status" className="notice">
            {t('mapYouDenied')}
          </p>
        )}
        {locating && source !== 'location' && (
          <p role="status" className="notice">
            {t('mapYouWaiting')}
          </p>
        )}
        {source === 'location' && (
          <p className="notice map-source location">{t(away ? 'mapYouAway' : 'mapYou')}</p>
        )}
        {shown?.source === 'estimate' && (
          <p className="notice map-source estimate">
            {shown.estimate.kind === 'riding'
              ? t('mapBetween', { from: shown.estimate.from, to: shown.estimate.to })
              : t('mapAtStop', { stop: shown.estimate.at })}
          </p>
        )}
        {straight && !failed && <p className="notice map-legend">{t('mapStraight')}</p>}
      </div>
      <div ref={box} className="map" />
    </main>
  );
}
