// Keep the map for offline (0.34.0): a trip's route map, fetched only on the person's tap (⋯ →
// Keep map for offline). The tiles go from the device to the tile host as the map's own do, so
// the host learns the route at those zooms: asked, never in the background. They land in the
// same caches as the map as seen (the service worker's, else the page's: `mapFetch`).
import type { StyleSpecification } from 'maplibre-gl';
import { mapData, styleFont } from '../core/mapdata';
import type { Connection, Tour } from '../core/model';
import { tilesAlong, tileUrl } from '../core/routeTiles';
import { log } from '../io/log';
import { mapFetch } from '../io/mapCache';
import { stopSearch } from '../io/stops';
import type { Lang } from '../i18n';
import { inPage, MAP_STYLE, MAP_STYLE_DARK } from './mapBase';
import { TEMPLATES } from './TemplatePicker';

const get = (url: string, signal: AbortSignal) =>
  inPage() ? mapFetch(url, signal) : fetch(url, { signal });

/** Asks four at a time: quick enough, and gentle on a volunteer-run tile host. */
const AT_ONCE = 4;

export interface Kept {
  done: number;
  total: number;
  failed: number;
}

export async function keepTripMap(
  route: Tour,
  chain: Connection[] | undefined,
  lang: Lang,
  dark: boolean,
  signal: AbortSignal,
  onProgress: (k: Kept) => void,
): Promise<Kept> {
  const index = await stopSearch();
  const d = mapData(route, chain, TEMPLATES, (r) => index.byRef(r), lang);
  const lines = d.lines.features.map((f) => f.geometry.coordinates as [number, number][]);
  // The style (light or dark, as the device is), its tiles' TileJSON, the labels' first glyphs
  // and the sprite: what the map needs to draw these tiles with no network.
  const styleRes = await get(dark ? MAP_STYLE_DARK : MAP_STYLE, signal);
  const style = (await styleRes.json()) as StyleSpecification;
  const source = Object.values(style.sources).find(
    (s): s is { type: 'vector'; url: string } => s.type === 'vector' && 'url' in s && !!s.url,
  );
  if (!source) throw new Error('no vector source');
  const tilejson = (await (await get(source.url, signal)).json()) as { tiles?: string[] };
  const template = tilejson.tiles?.[0];
  if (!template) throw new Error('no tiles');
  const extra: string[] = [];
  if (typeof style.glyphs === 'string')
    for (const font of styleFont(style))
      extra.push(
        style.glyphs.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', '0-255'),
      );
  if (typeof style.sprite === 'string')
    for (const x of ['', '@2x']) extra.push(`${style.sprite}${x}.json`, `${style.sprite}${x}.png`);
  const urls = [...extra, ...tilesAlong(lines).map((t) => tileUrl(template, t))];
  const k: Kept = { done: 0, total: urls.length, failed: 0 };
  log('keepMap.start', { tiles: urls.length - extra.length, extra: extra.length, dark });
  let next = 0;
  const worker = async () => {
    while (next < urls.length && !signal.aborted) {
      const url = urls[next++]!;
      try {
        const res = await get(url, signal);
        if (!res.ok) k.failed++;
        // Read whole, so the cache has it all.
        await res.arrayBuffer();
      } catch {
        if (signal.aborted) return;
        k.failed++;
      }
      k.done++;
      onProgress({ ...k });
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  log('keepMap.done', { ...k, aborted: signal.aborted });
  return k;
}
