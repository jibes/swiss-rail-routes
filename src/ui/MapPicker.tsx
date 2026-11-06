// The map planner (0.24.0), loaded lazily: from a stop, every place its trains reach without a
// change, drawn as lines through their stops, the earliest arrival at each. A tap on one adds it;
// "and on from there" draws the same from it. A place no direct train reaches gets an estimate
// (by the nearest place reached and a change), said as about: the planner then plans it for real.
import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { toProtocol } from '../core/mapCache';
import { styleFont } from '../core/mapdata';
import type { Waypoint } from '../core/model';
import type { Departures } from '../core/ojp/departures';
import { zurichLocal } from '../core/planner/plan';
import { estimate, spiderWeb, type Reached, type Web } from '../core/spider';
import { stopKey } from '../core/stops';
import { fetchDepartures } from '../io/ojp';
import { log } from '../io/log';
import { useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { inPage, plain, registerMapProtocol, styleOf } from './mapBase';
import { RailLoader } from './RailLoader';
import { useStopIndex } from './useStopIndex';

type Stop = Pick<Waypoint, 'stopRef' | 'name'>;
const ACCENT = '#c0261b';
const BUS = '#6b7280';
/** A tap on the map takes the nearest station within this. */
const TAP_KM = 3;

interface Chosen {
  stop: Stop;
  /** Local time it is reached, `YYYY-MM-DDTHH:MM`. */
  at: string;
  direct?: Reached;
  about?: { minutes: number; via?: string };
}

const empty = () => ({ type: 'FeatureCollection' as const, features: [] });

function webData(web: Web, origin: { lon: number; lat: number } | undefined) {
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
        properties: { key: r.key, name: r.name, label: `${r.name} ${hhmm(r.arr)}` },
      })),
    },
    origin: {
      type: 'FeatureCollection' as const,
      features: origin
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [origin.lon, origin.lat] },
              properties: {},
            },
          ]
        : [],
    },
  };
}

export default function MapPicker({
  start,
  at,
  onAdd,
  onClose,
}: {
  start: Stop;
  /** When you leave `start`, local `YYYY-MM-DDTHH:MM`. */
  at: string;
  /** Adds the stop after the last one added; `on`: the web goes on from it. */
  onAdd: (stop: Stop, on: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const index = useStopIndex();
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [from, setFrom] = useState({ stop: start, at });
  const [answer, setAnswer] = useState<{ key: string; d: Departures } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [added, setAdded] = useState(0);
  useLayer(true, onClose);

  const fromKey = `${stopKey(from.stop.stopRef)}@${from.at}`;
  // One request per stop the web starts from, never in the background.
  useEffect(() => {
    const abort = new AbortController();
    log('mapPick.from', { stop: from.stop.name, at: from.at });
    fetchDepartures(
      {
        stop: { ref: stopKey(from.stop.stopRef), name: from.stop.name },
        time: from.at,
        results: 60,
      },
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
  }, [fromKey, from.stop, from.at, attempt]);

  const d = answer?.key === fromKey ? answer.d : null;
  const place = (k: string) => {
    const s = index?.byRef(k);
    return s ? { lat: s.lat, lon: s.lon } : undefined;
  };
  const originAt = place(stopKey(from.stop.stopRef)) ?? d?.places.get(stopKey(from.stop.stopRef));
  const web =
    d && index ? spiderWeb(d, { from: from.stop.stopRef, at: isoOf(from.at), place }) : null;

  // The map, once.
  useEffect(() => {
    if (!box.current) return;
    let gone = false;
    let m: maplibregl.Map | undefined;
    void styleOf().then((style) => {
      if (gone || !box.current) return;
      const page = inPage();
      if (page) registerMapProtocol();
      m = new maplibregl.Map({
        container: box.current,
        transformRequest: page ? (url) => ({ url: toProtocol(url) }) : undefined,
        style: style ?? plain(),
        bounds: [5.9, 45.8, 10.5, 47.8],
        attributionControl: { compact: true },
      });
      m.on('load', () => {
        if (!m) return;
        m.addSource('web-lines', { type: 'geojson', data: empty() });
        m.addSource('web-stops', { type: 'geojson', data: empty() });
        m.addSource('web-origin', { type: 'geojson', data: empty() });
        m.addLayer({
          id: 'web-lines',
          type: 'line',
          source: 'web-lines',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['case', ['get', 'bus'], BUS, ACCENT],
            'line-width': 3,
            'line-opacity': 0.75,
          },
        });
        m.addLayer({
          id: 'web-stops',
          type: 'circle',
          source: 'web-stops',
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-color': ACCENT,
            'circle-stroke-width': 2.5,
          },
        });
        m.addLayer({
          id: 'web-origin',
          type: 'circle',
          source: 'web-origin',
          paint: {
            'circle-radius': 9,
            'circle-color': ACCENT,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          },
        });
        if (style)
          m.addLayer({
            id: 'web-labels',
            type: 'symbol',
            source: 'web-stops',
            minzoom: 8,
            layout: {
              'text-field': ['get', 'label'],
              'text-font': styleFont(style),
              'text-size': 11,
              'text-offset': [0, 1.1],
              'text-anchor': 'top',
            },
            paint: { 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
          });
        setMap(m);
      });
    });
    return () => {
      gone = true;
      setMap(null);
      m?.remove();
    };
  }, []);

  // What is drawn follows the web; the view moves to it once per stop it starts from.
  const webJson = web ? JSON.stringify(webData(web, originAt)) : '';
  useEffect(() => {
    if (!map || !webJson) return;
    const data = JSON.parse(webJson) as ReturnType<typeof webData>;
    map.getSource<maplibregl.GeoJSONSource>('web-lines')?.setData(data.lines);
    map.getSource<maplibregl.GeoJSONSource>('web-stops')?.setData(data.stops);
    map.getSource<maplibregl.GeoJSONSource>('web-origin')?.setData(data.origin);
    const pts = [
      ...data.stops.features.map((f) => f.geometry.coordinates),
      ...data.origin.features.map((f) => f.geometry.coordinates),
    ];
    if (pts.length > 1) {
      const b = new maplibregl.LngLatBounds(pts[0] as [number, number], pts[0] as [number, number]);
      for (const p of pts) b.extend(p as [number, number]);
      map.fitBounds(b, { padding: 48, maxZoom: 11, duration: 0 });
    } else if (pts[0]) map.jumpTo({ center: pts[0] as [number, number], zoom: 10 });
  }, [map, webJson]);

  // A tap: a place the web reaches, else the nearest station, about how long to it.
  const tap = useRef<(e: maplibregl.MapMouseEvent) => void>(() => undefined);
  useEffect(() => {
    tap.current = (e) => {
      if (!web || !index || !originAt) return;
      const hit = map?.queryRenderedFeatures(e.point, { layers: ['web-stops'] })[0];
      const key = hit?.properties?.key as string | undefined;
      const direct = key ? web.reached.find((r) => r.key === key) : undefined;
      if (direct) {
        setChosen({
          stop: { stopRef: direct.key, name: direct.name },
          at: zurichLocal(Date.parse(direct.arr)),
          direct,
        });
        return;
      }
      const near = index.near({ lat: e.lngLat.lat, lon: e.lngLat.lng }, TAP_KM)[0];
      if (!near || stopKey(near.ref) === web.from) return setChosen(null);
      const est = estimate(web, isoOf(from.at), originAt, near);
      setChosen({
        stop: { stopRef: near.ref, name: near.name },
        at: zurichLocal(Date.parse(isoOf(from.at)) + est.minutes * 60_000),
        about: { minutes: est.minutes, via: est.via?.name },
      });
    };
  });
  useEffect(() => {
    if (!map) return;
    const on = (e: maplibregl.MapMouseEvent) => tap.current(e);
    map.on('click', on);
    return () => void map.off('click', on);
  }, [map]);

  const add = (c: Chosen, on: boolean) => {
    log('mapPick.add', { stop: c.stop.name, direct: !!c.direct, on });
    onAdd(c.stop, on);
    setAdded((n) => n + 1);
    setChosen(null);
    if (on) setFrom({ stop: c.stop, at: c.at });
    else onClose();
  };

  return (
    <div className="map-picker" role="dialog" aria-modal="true" aria-label={t('mapPickTitle')}>
      <div className="map-picker-bar">
        <button type="button" className="icon" aria-label={t('close')} onClick={onClose}>
          <Icon name="close" />
        </button>
        <p className="map-picker-from">
          {t('mapPickFrom', { stop: from.stop.name, time: from.at.slice(11) })}
          {added > 0 && <span className="muted"> · {t('mapPickAdded', { n: added })}</span>}
        </p>
      </div>
      <div className="map-picker-notes">
        {!d && !failed && <RailLoader label={t('mapPickLoading')} />}
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
        {web && web.reached.length > 0 && !chosen && (
          <p className="notice map-legend">{t('mapPickHint')}</p>
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
                      setChosen({
                        stop: { stopRef: r.key, name: r.name },
                        at: zurichLocal(Date.parse(r.arr)),
                        direct: r,
                      })
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
      {chosen && (
        <div className="map-picker-card" role="status">
          <h2>{chosen.stop.name}</h2>
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
          <div className="map-picker-actions">
            <button type="button" className="primary" onClick={() => add(chosen, false)}>
              {t('mapPickAdd')}
            </button>
            <button type="button" className="secondary" onClick={() => add(chosen, true)}>
              {t('mapPickAddOn')}
            </button>
          </div>
        </div>
      )}
      <div ref={box} className="map" role="region" aria-label={t('map')} />
    </div>
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
