// Map screen, loaded lazily (MapLibre is the largest dependency).
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expectedArrival } from '../core/live';
import { toProtocol } from '../core/mapCache';
import { mapData, styleFont } from '../core/mapdata';
import { useFocusStop } from './focusStop';
import { entriesOf } from '../core/line';
import { leaveTime } from '../core/spider';
import { log } from '../io/log';
import { MapAdd } from './MapAdd';
import { useMapAdd } from './mapAdd';
import { RunSheet } from './RunSheet';
import { useDark } from './useDark';
import { inPage, plain, registerMapProtocol, styleOf } from './mapBase';
export { MAP_STYLE } from './mapBase';
import type { Connection, Section } from '../core/model';
import { accuracyArea, estimatedPosition, shownPosition } from '../core/position';
import { stopKey } from '../core/stops';
import { isLive, isPlanned } from '../core/trip';
import { plannedRows } from '../core/rows';
import { placeWith, tempText } from '../core/weather';
import { weatherMap } from '../core/weatherMap';
import { addWeatherLayers, setWeather } from './mapWeather';
import { weatherWords } from './WeatherCell';
import { useWeather } from './useWeather';
import { restDraft, useRestDrafts } from './restDraft';
import { stopSearch } from '../io/stops';
import { loadPlans } from '../io/tours';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { NotFound } from './NotFound';
import { TEMPLATES } from './TemplatePicker';
import { Compass, Icon } from './icons';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { canLocate, useLocation } from './useLocation';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';

const ACCENT = '#c0261b';
const ACCENT_DARK = '#7a140d';
const LOCATION = '#1a73e8';

/**
 * The way each ride goes, as arrowheads on the line: a way back on the same tracks shows
 * arrows both ways. Drawn here, so it needs neither the style's sprite nor the tile host.
 */
function arrowImage(r: number): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 16 * r;
  const g = c.getContext('2d')!;
  g.scale(r, r);
  g.lineJoin = 'round';
  g.beginPath();
  // A dart, notched at the back: unlike a plain triangle, it can only point one way.
  g.moveTo(2, 3.5);
  g.lineTo(14, 8);
  g.lineTo(2, 12.5);
  g.lineTo(5, 8);
  g.closePath();
  // White round a dark head: readable on the red line and off it at corners.
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = ACCENT_DARK;
  g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}

/** How long the wave runs at most, while a trip is being planned. */
const WAVE_MS = 30_000;
/**
 * The wave along the line (`line-progress` 0 → 1): a light band centred at `p`. Stops must rise
 * strictly, so the band is clipped inside (0, 1).
 */
function waveGradient(p: number, dark: boolean): maplibregl.ExpressionSpecification {
  const light = dark ? 'rgba(27,29,33,0.75)' : 'rgba(255,255,255,0.8)';
  const none = dark ? 'rgba(27,29,33,0)' : 'rgba(255,255,255,0)';
  const w = 0.12;
  const a = Math.min(0.997, Math.max(0.001, p - w));
  const b = Math.min(0.998, Math.max(a + 0.0005, p));
  const c = Math.min(0.999, Math.max(b + 0.0005, p + w));
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    none,
    a,
    none,
    b,
    light,
    c,
    none,
    1,
    none,
  ];
}

const focusPoint = (p: [number, number] | null) => ({
  type: 'FeatureCollection' as const,
  features: p
    ? [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: p },
          properties: {},
        },
      ]
    : [],
});

/** A station's temperature by its key, else by its name (`<key>\n<name>`). */
function tempAt(temps: Map<string, number>, both: string) {
  const [key, name] = both.split('\n');
  return temps.get(key!) ?? temps.get(`name:${name}`);
}

/** A name on the map with the temperature there after it, muted (none without one). */
function showTemp(el: HTMLElement, c: number | undefined) {
  let span = el.querySelector<HTMLElement>('.map-temp');
  if (c === undefined) return span?.remove();
  if (!span) {
    span = document.createElement('span');
    span.className = 'map-temp';
    el.append(span);
  }
  span.textContent = ` ${tempText(c)}`;
}

/** A trip's map: its saved connections, or its last plan while it has none. */
export default function MapView({ id }: { id: string }) {
  const t = useT();
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const tour = trip?.route;
  const tripChain = trip?.chain?.connections;
  const box = useRef<HTMLDivElement>(null);
  // The station names on the map, by key, and the temperature at each (0.38.0).
  const nameEls = useRef(new Map<string, HTMLElement>());
  const temps = useRef(new Map<string, number>());
  const [failed, setFailed] = useState(false);
  // Some stretch has no track shape (drawn straight and dashed): say what dashed means.
  const [straight, setStraight] = useState(false);
  const json = tour ? JSON.stringify([tour, tripChain ?? null]) : '';
  // The map, once it can take what is drawn on it after loading.
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  // A move of the map: whether the location is in view is read from it.
  const [, setMoved] = useState(0);
  // Turned or tilted by a gesture: the compass shows, and a tap brings north up again.
  const [turn, setTurn] = useState({ bearing: 0, pitch: 0 });

  // Where you are: by the time while the trip is under way, by the device when asked to.
  const now = useNow();
  const liveStatus = useLiveStatus((s) => s.status);
  // Live information only depends on the time (0.52.0); the trip is edited the same way always.
  const underWay =
    !!trip &&
    isPlanned(trip) &&
    isLive(trip, now, expectedArrival(trip.chain.connections, liveStatus));
  const live = useLive(underWay && trip && isPlanned(trip) ? trip : undefined);
  const state = live.state;
  const index = useStopIndex();
  const estimate = useMemo(
    () => (state && index ? estimatedPosition(state, (k) => index.byRef(stopKey(k))) : null),
    [state, index],
  );
  const lang = usePrefs((s) => s.lang);
  const dark = useDark();
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

  // The map, once per trip and theme: what is drawn on it follows the trip below, so adding a
  // stop (on the map or beside it) never builds it again.
  const [font, setFont] = useState<string[] | null>(null);
  useEffect(() => {
    if (!id || !box.current) return;
    let map: maplibregl.Map | undefined;
    let gone = false;
    (async () => {
      const style = await styleOf(dark);
      if (!style) setFailed(true);
      if (gone || !box.current) return;
      const page = inPage();
      if (page) registerMapProtocol();
      map = new maplibregl.Map({
        container: box.current,
        transformRequest: page ? (url) => ({ url: toProtocol(url) }) : undefined,
        style: style ?? plain(),
        bounds: [5.9, 45.8, 10.5, 47.8],
        attributionControl: { compact: true },
      });
      // One tile failing on a map that shows others is no failure of the map (review of
      // 11 Nov 2026: the note stayed on a working map); none shown yet, it is.
      let tiles = false;
      map.on('data', (e) => {
        if (e.dataType === 'source' && 'tile' in e && e.tile) tiles = true;
      });
      map.on('error', (e) => {
        if (!(tiles && 'tile' in e && e.tile)) setFailed(true);
      });
      map.on('moveend', () => setMoved((n) => n + 1));
      const turned = () => {
        if (map) setTurn({ bearing: map.getBearing(), pitch: map.getPitch() });
      };
      map.on('rotate', turned);
      map.on('pitch', turned);
      map.on('load', () => {
        if (!map) return;
        const empty = focusPoint(null);
        // Line metrics: the wave runs along the line by its progress while the trip is planned.
        map.addSource('lines', { type: 'geojson', data: empty, lineMetrics: true });
        map.addSource('stops', { type: 'geojson', data: empty });
        map.addSource('changes', { type: 'geojson', data: empty });
        map.addSource('highlights', { type: 'geojson', data: empty });
        map.addSource('accuracy', { type: 'geojson', data: accuracyArea(null) });
        map.addSource('focus', { type: 'geojson', data: empty });
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
        // Sharp on any screen; its own name, as the style's sprite may have an 'arrow'.
        const ratio = Math.ceil(window.devicePixelRatio || 1);
        map.addImage('srr-arrow', arrowImage(ratio), { pixelRatio: ratio });
        map.addLayer({
          id: 'arrows',
          type: 'symbol',
          source: 'lines',
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 110,
            'icon-image': 'srr-arrow',
            // Every ride's arrows, also where a way back lies on the way out; and they never
            // push a highlight's name away.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
        map.addLayer({
          id: 'stops',
          type: 'circle',
          source: 'stops',
          paint: {
            // Yours one size, a via as a stop (picked on the map or by name); a line's stations small.
            'circle-radius': ['case', ['get', 'ring'], 4, 7],
            'circle-color': dark ? '#1b1d21' : '#ffffff',
            'circle-stroke-color': ACCENT,
            'circle-stroke-width': 3,
          },
        });
        // Where the plan changes trains (0.42.0): a smaller ring than your own stations.
        map.addLayer({
          id: 'changes',
          type: 'circle',
          source: 'changes',
          paint: {
            'circle-radius': 5,
            'circle-color': dark ? '#1b1d21' : '#ffffff',
            'circle-stroke-color': ACCENT,
            'circle-stroke-width': 2.5,
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
        // The station the pointer is on in the trip beside the map (desktop columns).
        map.addLayer({
          id: 'focus',
          type: 'circle',
          source: 'focus',
          paint: {
            'circle-radius': 13,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': ACCENT,
            'circle-stroke-width': 3,
          },
        });
        addWeatherLayers(map, dark);
        // Names need the style's fonts: none on the plain ground (the highlights still show).
        if (style) {
          map.addLayer({
            id: 'labels',
            type: 'symbol',
            source: 'highlights',
            layout: {
              'text-field': ['get', 'name'],
              'text-font': styleFont(style),
              'text-size': 12,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
            },
            paint: {
              'text-color': dark ? '#f2f2f2' : '#1a1a1a',
              'text-halo-color': dark ? '#1b1d21' : '#ffffff',
              'text-halo-width': 1.5,
            },
          });
          setFont(styleFont(style));
        }
        setMap(map);
      });
    })().catch(() => setFailed(true));
    return () => {
      gone = true;
      setMap(null);
      setFont(null);
      map?.remove();
    };
  }, [id, dark]);

  // What is drawn: the trip as it is now, its saved connections or its last plan; the view takes
  // it in once, when the map opens.
  const fittedFor = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    if (!map || !json) return;
    const [current, savedChain] = JSON.parse(json) as [
      NonNullable<typeof tour>,
      Connection[] | null,
    ];
    const routeJson = JSON.stringify(current);
    let gone = false;
    const names: maplibregl.Marker[] = [];
    nameEls.current = new Map();
    (async () => {
      const [index, plans] = await Promise.all([stopSearch(), loadPlans()]);
      if (gone) return;
      const saved = plans[id];
      const chain: Connection[] | undefined =
        savedChain ??
        (saved?.tourJson === routeJson ? saved.result.recommended?.connections : undefined);
      const d = mapData(current, chain, TEMPLATES, (r) => index.byRef(r), lang);
      drawn.current = chain ?? [];
      setStraight(d.lines.features.some((f) => !f.properties.exact));
      map.getSource<maplibregl.GeoJSONSource>('lines')?.setData(d.lines);
      map.getSource<maplibregl.GeoJSONSource>('stops')?.setData(d.stops);
      map.getSource<maplibregl.GeoJSONSource>('changes')?.setData(d.changes);
      map.getSource<maplibregl.GeoJSONSource>('highlights')?.setData(d.highlights);
      // Named without the style's fonts (HTML markers), so the plain ground has names too:
      // every station you chose (a via picked on the map as one typed), not a line's own.
      for (const f of [...d.stops.features, ...d.changes.features]) {
        if (f.properties.ring) continue;
        const el = document.createElement('div');
        // A change the plan chose: named too, smaller.
        el.className = f.properties.change ? 'map-name change' : 'map-name';
        el.textContent = String(f.properties.name ?? '');
        const key = `${String(f.properties.key)}\n${String(f.properties.name)}`;
        nameEls.current.set(key, el);
        showTemp(el, tempAt(temps.current, key));
        names.push(
          new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 9] })
            .setLngLat(f.geometry.coordinates)
            .addTo(map),
        );
      }
      if (fittedFor.current !== map && d.bounds) {
        fittedFor.current = map;
        map.fitBounds(d.bounds, { padding: 40, duration: 0 });
      }
    })().catch(() => setFailed(true));
    return () => {
      gone = true;
      for (const m of names) m.remove();
    };
  }, [map, json, id, lang]);

  // The weather (0.38.0): the line's own answer (the same question, kept), drawn on the map;
  // each named station's temperature after its name.
  const rows = useMemo(
    () => (tour && tripChain ? plannedRows(tour, tripChain) : []),
    [tour, tripChain],
  );
  const weather = useWeather(rows, rows.length > 0);
  const wx = weather && 'rows' in weather ? weather : null;
  const wmap = useMemo(
    () =>
      wx && index
        ? weatherMap(
            rows,
            wx.rows,
            placeWith((r) => {
              const s = index.byRef(r);
              return s ? { lat: s.lat, lon: s.lon } : undefined;
            }, rows),
            now,
          )
        : null,
    [wx, index, rows, now],
  );
  useEffect(() => {
    temps.current = wmap?.temps ?? new Map();
    for (const [key, el] of nameEls.current) showTemp(el, tempAt(temps.current, key));
    if (map) setWeather(map, wmap);
  }, [map, wmap]);
  // A tap on a column or an icon: the line's own words for it.
  // Adding on the map: the web from a station of this trip, under its red; a tap is the
  // adding's then, not the weather's (review of 11 Nov 2026).
  const adding = useMapAdd((s) => s.add?.trip === id);
  useEffect(() => {
    if (!map || !wx || adding) return;
    let pop: maplibregl.Popup | null = null;
    const open = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const r = f && rows[Number(f.properties.row)];
      const w = f && wx.rows[Number(f.properties.row)];
      if (!r || !w || f.geometry.type !== 'Point') return;
      const words =
        r.type === 'station'
          ? weatherWords(t, w, r.name, r.arr ?? r.dep, wx.source, wx.at)
          : weatherWords(
              t,
              w,
              `${r.section.from.name} – ${r.section.to.name}`,
              r.section.from.dep,
              wx.source,
              wx.at,
              true,
            );
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      const b = document.createElement('b');
      b.textContent = words.title;
      el.append(b);
      for (const d of words.detail) {
        const line = document.createElement('span');
        line.textContent = d;
        el.append(line);
      }
      pop?.remove();
      pop = new maplibregl.Popup({ closeButton: false, className: 'wx-pop', offset: 12 })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setDOMContent(el)
        .addTo(map);
      log('weather.map.tap', { row: Number(f.properties.row), type: r.type });
    };
    const pointer = () => (map.getCanvas().style.cursor = 'pointer');
    const plain = () => (map.getCanvas().style.cursor = '');
    for (const id of ['wx-rain', 'wx-sky']) {
      map.on('click', id, open);
      map.on('mouseenter', id, pointer);
      map.on('mouseleave', id, plain);
    }
    return () => {
      pop?.remove();
      for (const id of ['wx-rain', 'wx-sky']) {
        map.off('click', id, open);
        map.off('mouseenter', id, pointer);
        map.off('mouseleave', id, plain);
      }
    };
  }, [map, wx, rows, t, adding]);

  // Being planned (0.36.0): a light wave runs along the line, the way it will be redrawn, until
  // the timetable comes (at most WAVE_MS, so offline it does not run on for good).
  const replanning = !!trip && !isPlanned(trip);
  useEffect(() => {
    // Without motion, nothing: the trip line says it is being planned.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!map || !replanning || still || !map.getSource('lines')) return;
    map.addLayer(
      {
        id: 'lines-wave',
        type: 'line',
        source: 'lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 6, 'line-gradient': waveGradient(0, dark) },
      },
      'arrows',
    );
    let frame = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      if (t - t0 > WAVE_MS) return;
      map.setPaintProperty(
        'lines-wave',
        'line-gradient',
        waveGradient(((t - t0) % 1800) / 1500, dark),
      );
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      if (map.getLayer('lines-wave')) map.removeLayer('lines-wave');
    };
  }, [map, replanning, dark]);

  // Adding on the map: the web from a station of this trip, under its red (`adding`, above).
  // A ride's line tapped: its train's whole run (0.47.0), the sheet its badge opens on the list.
  const drawn = useRef<Connection[]>([]);
  const [run, setRun] = useState<Section | null>(null);
  useEffect(() => {
    if (!map || adding) return;
    const open = (e: maplibregl.MapLayerMouseEvent) => {
      // The weather's own card wins where its icon lies on the line.
      if (map.queryRenderedFeatures(e.point, { layers: ['wx-rain', 'wx-sky'] }).length) return;
      const p = e.features?.[0]?.properties;
      const s = p?.planned ? drawn.current[Number(p.leg)]?.sections[Number(p.section)] : undefined;
      if (!s || s.mode === 'walk') return;
      log('run.map', { journey: s.journey });
      setRun(s);
    };
    const pointer = () => (map.getCanvas().style.cursor = 'pointer');
    const plain = () => (map.getCanvas().style.cursor = '');
    map.on('click', 'lines', open);
    map.on('mouseenter', 'lines', pointer);
    map.on('mouseleave', 'lines', plain);
    return () => {
      map.off('click', 'lines', open);
      map.off('mouseenter', 'lines', pointer);
      map.off('mouseleave', 'lines', plain);
    };
  }, [map, adding]);
  const startAdd = useMapAdd((s) => s.start);
  const fitWeb = useCallback(
    (pts: [number, number][]) => {
      if (!map || !pts.length) return;
      const b = new maplibregl.LngLatBounds(pts[0]!, pts[0]!);
      for (const p of pts) b.extend(p);
      map.fitBounds(b, { padding: { top: 120, bottom: 160, left: 40, right: 40 }, maxZoom: 11 });
    },
    [map],
  );
  /**
   * From the trip's last station, when the plan leaves it (or arrives and stays). Under way
   * (0.46.0), from the rest's: what is added goes into the rest being changed, begun here if
   * the trip screen has not begun it, and Update on the trip saves it.
   */
  const addFromEnd = () => {
    if (!tour || !trip) return;
    let rest = useRestDrafts.getState().drafts[id];
    if (underWay && !rest && state && isPlanned(trip)) {
      rest = restDraft(trip, state, live.now) ?? undefined;
      if (rest) useRestDrafts.getState().set(id, rest);
    }
    const under = underWay ? rest : undefined;
    if (underWay && !under) return;
    const route = under?.route ?? tour;
    const entries = entriesOf(route);
    const after = entries.length - 1;
    const w = entries[after]?.w;
    if (!w) return;
    log('mapPick.open', { trip: id, after, from: 'map', rest: !!under });
    startAdd({
      trip: id,
      after,
      from: { stopRef: w.stopRef, name: w.name },
      at: leaveTime(route, under ? undefined : tripChain, w.stopRef),
      ...(under ? { rest: true } : {}),
    });
  };

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
  const focus = useFocusStop((s) => s.key);
  const focusAt = focus && index ? index.byRef(focus) : undefined;
  const fLon = focusAt?.lon;
  const fLat = focusAt?.lat;
  useEffect(() => {
    map
      ?.getSource<maplibregl.GeoJSONSource>('focus')
      ?.setData(focusPoint(fLon !== undefined && fLat !== undefined ? [fLon, fLat] : null));
  }, [map, fLon, fLat]);
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
          className="icon map-back"
          aria-label={t('back')}
          // Up to the trip, as on every screen: the map may have been opened from a link.
          onClick={() => go(`/trip/${id}`)}
        >
          <Icon name="back" />
        </button>
        <div className="map-tools">
          {!adding && (!underWay || state) && map && (
            <button
              type="button"
              className="icon"
              aria-label={t('mapAddStops')}
              title={t('mapAddStops')}
              onClick={addFromEnd}
            >
              <Icon name="plus" />
            </button>
          )}
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
          {map && (Math.abs(turn.bearing) > 0.5 || turn.pitch > 0.5) && (
            <button
              type="button"
              className="icon compass"
              aria-label={t('mapNorth')}
              // Only the view turns back: never moved, so tiles tell nothing new.
              onClick={() => map.easeTo({ bearing: 0, pitch: 0 })}
            >
              <Compass bearing={turn.bearing} />
            </button>
          )}
        </div>
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
      {map && adding && <MapAdd map={map} dark={dark} font={font} fit={fitWeb} />}
      {run && <RunSheet s={run} onClose={() => setRun(null)} />}
      <div ref={box} className="map" />
    </main>
  );
}
