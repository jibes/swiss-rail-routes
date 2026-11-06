// Adding on the trip's own map (0.32.0, was the separate map planner): from a station of the
// trip, every place its trains reach without a change, in blue under the trip's red, darker the
// sooner; the biggest named. A tap on one, or anywhere (the stops near it), says how to get there;
// Add puts it after the station and the web goes on from it. One request per station it starts
// from, never in the background.
import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { insertEntries, stationEntry } from '../core/line';
import { nearbyChoices, type NearChoice } from '../core/nearby';
import type { Departures } from '../core/ojp/departures';
import { zurichLocal } from '../core/planner/plan';
import { biggest, estimate, spiderWeb, type Reached, type Web } from '../core/spider';
import { kmBetween, stopKey } from '../core/stops';
import { log } from '../io/log';
import { fetchDepartures } from '../io/ojp';
import { useT } from '../store';
import { useTrips } from '../trips';
import { hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { useMapAdd, type MapAdd as Add } from './mapAdd';
import { RailLoader } from './RailLoader';
import { useStopIndex } from './useStopIndex';

type Stop = { stopRef: string; name: string };

interface Chosen {
  stop: Stop;
  /** Local time it is reached, `YYYY-MM-DDTHH:MM`. */
  at: string;
  direct?: Reached;
  about?: { minutes: number; via?: string };
}

const KIND_LABEL = {
  train: 'kindTrain',
  cable: 'kindCable',
  boat: 'kindBoat',
  tram: 'kindTram',
  bus: 'kindBus',
} as const;

/** The web's colour: one hue, apart from the trip's red; lighter on a dark map. */
export const webColour = (dark: boolean) => (dark ? '#8cb4e0' : '#2b5c8a');
const LAYERS = ['web-labels', 'web-stops', 'web-lines'];

function webData(web: Web, at: string) {
  const top = biggest(web);
  const t0 = Date.parse(at);
  return {
    lines: {
      type: 'FeatureCollection' as const,
      features: web.lines.map((l) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: l.coords },
        properties: { bus: l.mode === 'bus' },
      })),
    },
    stops: {
      type: 'FeatureCollection' as const,
      features: web.reached.map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.pos.lon, r.pos.lat] },
        properties: {
          key: r.key,
          label: `${r.name} ${hhmm(r.arr)}`,
          top: top.has(r.key),
          min: Math.max(0, (Date.parse(r.arr) - t0) / 60_000),
        },
      })),
    },
  };
}

/** The web's sources and layers, under the trip's own (so its red stays on top). */
function addLayers(m: maplibregl.Map, dark: boolean, font: string[] | null) {
  const blue = webColour(dark);
  const halo = dark ? '#1b1d21' : '#ffffff';
  const empty = { type: 'FeatureCollection' as const, features: [] };
  m.addSource('web-lines', { type: 'geojson', data: empty });
  m.addSource('web-stops', { type: 'geojson', data: empty });
  const below = m.getLayer('lines') ? 'lines' : undefined;
  m.addLayer(
    {
      id: 'web-lines',
      type: 'line',
      source: 'web-lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': blue,
        'line-width': ['case', ['get', 'bus'], 1.5, 2.5],
        'line-opacity': 0.55,
      },
    },
    below,
  );
  // Darker the sooner: full at once, fading to a third by the three hours' horizon.
  const sooner = ['interpolate', ['linear'], ['get', 'min'], 0, 1, 180, 0.35];
  m.addLayer(
    {
      id: 'web-stops',
      type: 'circle',
      source: 'web-stops',
      paint: {
        'circle-radius': ['case', ['get', 'top'], 6, 4],
        'circle-color': halo,
        'circle-stroke-color': blue,
        'circle-stroke-width': 2.5,
        'circle-opacity': sooner as unknown as number,
        'circle-stroke-opacity': sooner as unknown as number,
      },
    },
    below,
  );
  // Names need the style's fonts: the biggest from the start, the rest as you zoom in.
  if (font)
    m.addLayer({
      id: 'web-labels',
      type: 'symbol',
      source: 'web-stops',
      filter: ['any', ['get', 'top'], ['>=', ['zoom'], 10]],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': font,
        'text-size': 11,
        'text-offset': [0, 1],
        'text-anchor': 'top',
        'symbol-sort-key': ['case', ['get', 'top'], 0, 1],
      },
      paint: { 'text-color': blue, 'text-halo-color': halo, 'text-halo-width': 1.5 },
    });
}

export function MapAdd({
  map,
  dark,
  font,
  fit,
}: {
  map: maplibregl.Map;
  dark: boolean;
  /** The style's fonts, none on the plain ground (no names then, a hover or tap says them). */
  font: string[] | null;
  /** Shows the web: the trip and the places reached in view. */
  fit: (pts: [number, number][]) => void;
}) {
  const t = useT();
  const add = useMapAdd((s) => s.add) as Add;
  const startAdd = useMapAdd((s) => s.start);
  const stop = useMapAdd((s) => s.stop);
  const index = useStopIndex();
  const [answer, setAnswer] = useState<{ key: string; d: Departures } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [near, setNear] = useState<NearChoice[] | null>(null);
  const [added, setAdded] = useState(0);
  const [hover, setHover] = useState<{ label: string; x: number; y: number } | null>(null);
  const done = useCallback(() => stop(), [stop]);
  useLayer(true, done);

  const fromKey = `${stopKey(add.from.stopRef)}@${add.at}`;
  // From a station abroad there is no web: its departures and their stops would be dozens of
  // requests to a community-run service (Transitous). Said, nothing asked.
  const abroad = add.from.stopRef.startsWith('eu:');
  useEffect(() => {
    if (abroad) return;
    const abort = new AbortController();
    log('mapPick.from', { stop: add.from.name, at: add.at });
    fetchDepartures(
      { stop: { ref: stopKey(add.from.stopRef), name: add.from.name }, time: add.at, results: 60 },
      abort.signal,
    ).then(
      (d) => {
        setFailed(false);
        setAnswer({ key: fromKey, d });
      },
      (e: unknown) => {
        if (abort.signal.aborted) return;
        log('mapPick.fail', { e });
        setFailed(true);
      },
    );
    return () => abort.abort();
  }, [fromKey, add.from, add.at, attempt, abroad]);

  const d = answer?.key === fromKey ? answer.d : null;
  const place = (k: string) => {
    const s = index?.byRef(k);
    return s ? { lat: s.lat, lon: s.lon } : undefined;
  };
  const fromKeyOnly = stopKey(add.from.stopRef);
  const originAt = place(fromKeyOnly) ?? d?.places.get(fromKeyOnly);
  const atIso = isoOf(add.at);
  const web = d && index ? spiderWeb(d, { from: add.from.stopRef, at: atIso, place }) : null;

  // The layers while adding; gone with it.
  useEffect(() => {
    if (!map.getSource('web-stops')) addLayers(map, dark, font);
    const canvas = map.getCanvas();
    canvas.classList.add('adding');
    return () => {
      canvas.classList.remove('adding');
      for (const l of LAYERS) if (map.getLayer(l)) map.removeLayer(l);
      for (const s of ['web-lines', 'web-stops']) if (map.getSource(s)) map.removeSource(s);
    };
  }, [map, dark, font]);

  // What is drawn follows the web; the view takes it in once per station it starts from.
  const webJson = web ? JSON.stringify(webData(web, atIso)) : '';
  const fitted = useRef('');
  // Set once per web: the station it starts from is a new object each render (log of 6 Nov
  // 2026: the same web set seven times), so it goes in by where it lies.
  const originLon = originAt?.lon;
  const originLat = originAt?.lat;
  useEffect(() => {
    if (!webJson) return;
    const data = JSON.parse(webJson) as ReturnType<typeof webData>;
    log('mapPick.web', { lines: data.lines.features.length, places: data.stops.features.length });
    map.getSource<maplibregl.GeoJSONSource>('web-lines')?.setData(data.lines);
    map.getSource<maplibregl.GeoJSONSource>('web-stops')?.setData(data.stops);
    if (fitted.current === fromKey) return;
    fitted.current = fromKey;
    const pts = data.stops.features.map((f) => f.geometry.coordinates as [number, number]);
    if (originLon !== undefined && originLat !== undefined) pts.push([originLon, originLat]);
    fit(pts);
  }, [map, webJson, fromKey, originLon, originLat, fit]);

  /** A stop picked: its train when one goes there direct, else about how long. */
  const choose = (s: { ref: string; name: string; lat: number; lon: number }) => {
    if (!web || !originAt) return;
    setNear(null);
    const direct = web.reached.find((r) => r.key === stopKey(s.ref));
    if (direct)
      return setChosen({
        stop: { stopRef: direct.key, name: direct.name },
        at: zurichLocal(Date.parse(direct.arr)),
        direct,
      });
    const est = estimate(web, atIso, originAt, s);
    setChosen({
      stop: { stopRef: s.ref, name: s.name },
      at: zurichLocal(Date.parse(atIso) + est.minutes * 60_000),
      about: { minutes: est.minutes, via: est.via?.name },
    });
  };

  // A place under the pointer (or near it: a dot is small), by a box round it.
  const hitAt = (p: { x: number; y: number }) =>
    map.queryRenderedFeatures(
      [
        [p.x - 10, p.y - 10],
        [p.x + 10, p.y + 10],
      ],
      { layers: ['web-stops'] },
    )[0];

  const tap = useRef<(e: maplibregl.MapMouseEvent) => void>(() => undefined);
  const move = useRef<(e: maplibregl.MapMouseEvent) => void>(() => undefined);
  useEffect(() => {
    tap.current = (e) => {
      if (!web || !index || !originAt) return;
      const key = hitAt(e.point)?.properties?.key as string | undefined;
      const direct = key ? web.reached.find((r) => r.key === key) : undefined;
      if (direct) {
        log('mapPick.tap', { direct: true });
        return choose({ ref: direct.key, name: direct.name, ...direct.pos });
      }
      // Anywhere else: the stops near it to choose from, how far by the zoom.
      const b = map.getBounds();
      const viewKm = kmBetween(
        { lat: e.lngLat.lat, lon: b.getWest() },
        { lat: e.lngLat.lat, lon: b.getEast() },
      );
      const choices = nearbyChoices(index, { lat: e.lngLat.lat, lon: e.lngLat.lng }, viewKm).filter(
        (c) => stopKey(c.ref) !== web.from,
      );
      log('mapPick.tap', { direct: false, near: choices.length, viewKm: Math.round(viewKm) });
      setChosen(null);
      setNear(choices.length ? choices : null);
    };
    move.current = (e) => {
      const f = hitAt(e.point);
      const label = f?.properties?.label as string | undefined;
      map.getCanvas().classList.toggle('on-place', !!label);
      setHover(label ? { label, x: e.point.x, y: e.point.y } : null);
    };
  });
  useEffect(() => {
    const onTap = (e: maplibregl.MapMouseEvent) => tap.current(e);
    const onMove = (e: maplibregl.MapMouseEvent) => move.current(e);
    const out = () => setHover(null);
    map.on('click', onTap);
    map.on('mousemove', onMove);
    map.on('mouseout', out);
    return () => {
      map.off('click', onTap);
      map.off('mousemove', onMove);
      map.off('mouseout', out);
    };
  }, [map]);

  const put = (c: Chosen) => {
    log('mapPick.add', { stop: c.stop.name, direct: !!c.direct });
    useTrips
      .getState()
      .editRoute(add.trip, (r) => insertEntries(r, add.after, [stationEntry(c.stop)]));
    setAdded((n) => n + 1);
    setChosen(null);
    // On from the stop added: the next goes after it.
    startAdd({ ...add, after: add.after + 1, from: c.stop, at: c.at });
  };

  return (
    <>
      <div className="map-add-bar">
        <p className="map-add-from">
          {t('mapPickFrom', { stop: add.from.name, time: add.at.slice(11) })}
          {added > 0 && <span className="muted"> · {t('mapPickAdded', { n: added })}</span>}
        </p>
        <button type="button" className="pill" onClick={done}>
          {t('mapPickDone')}
        </button>
      </div>
      <div className="map-add-notes">
        {abroad && (
          <p role="status" className="notice">
            {t('mapPickSwissOnly', { stop: add.from.name })}
          </p>
        )}
        {!abroad && !d && !failed && <RailLoader label={t('mapPickLoading')} />}
        {failed && (
          <p role="status" className="notice">
            {t('mapPickFailed')}{' '}
            <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>
              {t('retry')}
            </button>
          </p>
        )}
        {web && !web.reached.length && (
          <p role="status" className="notice">
            {t('mapPickNone')}
          </p>
        )}
        {web && web.reached.length > 0 && !chosen && !near && (
          <p className="notice map-add-hint">
            <span className="web-key" aria-hidden="true" />
            {t('mapPickHint', { stop: add.from.name })}
          </p>
        )}
        {web && web.reached.length > 0 && (
          // The same places as a list, earliest first: for screen readers, and to pick by name.
          <details className="map-picker-list">
            <summary>{t('mapPickList', { n: web.reached.length })}</summary>
            <ul>
              {web.reached.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      choose({ ref: r.key, name: r.name, lat: r.pos.lat, lon: r.pos.lon })
                    }
                  >
                    {r.name} <span className="muted">{hhmm(r.arr)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {hover && !chosen && (
        <span className="map-add-tip" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
          {hover.label}
        </span>
      )}
      {near && !chosen && (
        <div className="map-picker-card" role="status">
          <div className="map-picker-head">
            <h2>{t('mapPickNear')}</h2>
            <button
              type="button"
              className="icon"
              aria-label={t('close')}
              onClick={() => setNear(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <ul className="map-picker-near">
            {near.map((c) => (
              <li key={c.ref}>
                <button type="button" className="result" onClick={() => choose(c)}>
                  <span className={`r-icon kind-${c.kind}`} aria-hidden="true">
                    {c.kind !== 'train' && <Icon name={c.kind} />}
                  </span>
                  <span className="r-name">{c.name}</span>
                  <span className="r-sub">
                    {t(KIND_LABEL[c.kind])} ·{' '}
                    {c.km < 1 ? `${Math.round(c.km * 1000)} m` : `${c.km.toFixed(1)} km`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {chosen && (
        <div className="map-picker-card" role="status">
          <div className="map-picker-head">
            <h2>{chosen.stop.name}</h2>
            <button
              type="button"
              className="icon"
              aria-label={t('close')}
              onClick={() => setChosen(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <p>
            {chosen.direct
              ? t('mapPickDirect', {
                  time: hhmm(chosen.direct.arr),
                  line: [chosen.direct.category, chosen.direct.line].filter(Boolean).join(' '),
                  dep: hhmm(chosen.direct.dep),
                })
              : chosen.about?.via
                ? t('mapPickAboutVia', { h: dur(chosen.about.minutes), via: chosen.about.via })
                : t('mapPickAbout', { h: dur(chosen.about?.minutes ?? 0) })}
          </p>
          <button type="button" className="primary" onClick={() => put(chosen)}>
            {t('mapPickAdd')}
          </button>
        </div>
      )}
    </>
  );
}

/** `YYYY-MM-DDTHH:MM` Swiss local → ISO. */
function isoOf(local: string): string {
  const guess = Date.parse(`${local}:00Z`);
  // Swiss local is UTC+1 or +2: the one whose local time is this.
  for (const h of [1, 2]) {
    const t = guess - h * 3_600_000;
    if (zurichLocal(t) === local) return new Date(t).toISOString();
  }
  return new Date(guess).toISOString();
}

const dur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
