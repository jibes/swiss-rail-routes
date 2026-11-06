// What every map in the app shares (MapView, MapPicker): MapLibre's worker, the style, the plain
// ground without the tile host, and the map as seen kept in the page where no service worker does.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { fromProtocol, MAP_PROTOCOL } from '../core/mapCache';
import { mapFetch } from '../io/mapCache';

maplibregl.setWorkerUrl(workerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
/** On a dark device (0.32.0): the same tiles, OpenFreeMap's dark style. */
export const MAP_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
/** Without the tile host (offline, blocked): the route on a plain ground, still readable; the
    ground follows the theme (`--map-ground`), as a light one glares on a dark screen. */
export function plain(): maplibregl.StyleSpecification {
  const ground =
    getComputedStyle(document.documentElement).getPropertyValue('--map-ground').trim() || '#ecebe6';
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'ground', type: 'background', paint: { 'background-color': ground } }],
  };
}

/**
 * Where no service worker keeps the map as seen (the Android shell has none; a web page before
 * its worker controls it), the page keeps it: the tile host's addresses go through the app's own
 * protocol, answered by `mapFetch` (src/io/mapCache.ts).
 */
export const inPage = () => !navigator.serviceWorker?.controller;

let registered = false;
export function registerMapProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(MAP_PROTOCOL, async (p, abort) => {
    const url = fromProtocol(p.url);
    const res = await mapFetch(url, abort.signal);
    if (!res.ok) throw new maplibregl.AJAXError(res.status, res.statusText, url, await res.blob());
    const data =
      p.type === 'json'
        ? await res.json()
        : p.type === 'string'
          ? await res.text()
          : await res.arrayBuffer();
    return {
      data,
      cacheControl: res.headers.get('Cache-Control'),
      expires: res.headers.get('Expires'),
    };
  });
}

/** The map's style, fetched first: if it cannot be had, the plain one (and say so). */
export async function styleOf(dark = false): Promise<maplibregl.StyleSpecification | null> {
  const url = dark ? MAP_STYLE_DARK : MAP_STYLE;
  try {
    const signal = AbortSignal.timeout(8000);
    const res = inPage() ? await mapFetch(url, signal) : await fetch(url, { signal });
    return res.ok ? ((await res.json()) as maplibregl.StyleSpecification) : null;
  } catch {
    return null;
  }
}
