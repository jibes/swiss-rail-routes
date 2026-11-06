// The trip's weather on its map (0.38.0): rain columns above the stations and the sky beside each
// ride, as images drawn here (no sprite, no font: they show on the plain ground too). Collisions
// leave the rain and hide a sky icon in its way, as the map does with names.
import type * as maplibregl from 'maplibre-gl';
import type { SkyKind } from '../core/weather';
import type { WeatherMap } from '../core/weatherMap';

const RAIN = '#2f6fd1';
const SUN = '#f2b705';
const W = 10;
const H = 40;

function canvas(w: number, h: number, r: number) {
  const c = document.createElement('canvas');
  c.width = w * r;
  c.height = h * r;
  const g = c.getContext('2d')!;
  g.scale(r, r);
  return { g, done: () => g.getImageData(0, 0, c.width, c.height) };
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 3) {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, h / 2));
}

/** A column `tenths`/10 full; at night outlined and light, as on the line. */
function rainImage(tenths: number, day: boolean, dark: boolean, r: number) {
  const { g, done } = canvas(W + 2, H + 2, r);
  round(g, 1, 1, W, H);
  g.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  g.fill();
  g.strokeStyle = dark ? '#1b1d21' : '#ffffff';
  g.lineWidth = 1;
  g.stroke();
  const h = (H * tenths) / 10;
  round(g, 1, 1 + H - h, W, h);
  if (day) {
    g.fillStyle = RAIN;
    g.fill();
  } else {
    g.fillStyle = 'rgba(47,111,209,0.25)';
    g.fill();
    g.strokeStyle = RAIN;
    g.lineWidth = 1.5;
    g.stroke();
  }
  return done();
}

function sun(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = SUN;
  g.strokeStyle = SUN;
  g.lineWidth = 2 * s;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, 6 * s, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.beginPath();
    g.moveTo(x + 9 * s * Math.cos(a), y + 9 * s * Math.sin(a));
    g.lineTo(x + 12 * s * Math.cos(a), y + 12 * s * Math.sin(a));
    g.stroke();
  }
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, fill: string) {
  g.beginPath();
  g.moveTo(x - 11, y + 6);
  g.lineTo(x + 11, y + 6);
  g.arc(x + 9, y, 6, Math.PI / 2, -Math.PI / 3, true);
  g.arc(x + 1, y - 4, 8, -Math.PI / 6, Math.PI + Math.PI / 6, true);
  g.arc(x - 9, y + 1, 5, -Math.PI / 2, Math.PI / 2, true);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function moon(g: CanvasRenderingContext2D, x: number, y: number, dark: boolean) {
  g.beginPath();
  g.arc(x, y, 9, Math.PI * 0.3, Math.PI * 1.7, false);
  g.arc(x + 5, y - 2, 7.5, Math.PI * 1.55, Math.PI * 0.45, true);
  g.closePath();
  g.fillStyle = dark ? '#c9cfdb' : '#5a6478';
  g.fill();
}

/** The sky's icon, with a thin halo like the names on the map, so it reads on any ground. */
function skyImage(kind: SkyKind, dark: boolean, r: number) {
  const size = 32;
  const { g, done } = canvas(size, size, r);
  const c = size / 2;
  const grey = dark ? '#9aa0aa' : '#aeb2b8';
  g.shadowColor = dark ? '#1b1d21' : '#ffffff';
  g.shadowBlur = 2.5;
  // Drawn twice: the shadow as a halo, then sharp.
  for (const pass of [0, 1]) {
    if (pass) g.shadowColor = 'transparent';
    if (kind === 'sun') sun(g, c, c, 1);
    if (kind === 'part') {
      sun(g, c + 5, c - 5, 0.75);
      cloud(g, c - 1, c + 3, grey);
    }
    if (kind === 'cloud') cloud(g, c, c + 1, grey);
    if (kind === 'night') moon(g, c, c, dark);
  }
  return done();
}

const KINDS: SkyKind[] = ['sun', 'part', 'cloud', 'night'];
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** Images, sources and layers, once per map (above the line and its stations). */
export function addWeatherLayers(map: maplibregl.Map, dark: boolean) {
  const r = Math.ceil(window.devicePixelRatio || 1);
  for (let n = 2; n <= 10; n++)
    for (const day of [true, false])
      map.addImage(`srr-rain-${n}${day ? '' : '-n'}`, rainImage(n, day, dark, r), {
        pixelRatio: r,
      });
  for (const k of KINDS) map.addImage(`srr-sky-${k}`, skyImage(k, dark, r), { pixelRatio: r });
  map.addSource('wx-rain', { type: 'geojson', data: EMPTY });
  map.addSource('wx-sky', { type: 'geojson', data: EMPTY });
  const dim: maplibregl.ExpressionSpecification = ['case', ['get', 'past'], 0.4, 1];
  map.addLayer({
    id: 'wx-sky',
    type: 'symbol',
    source: 'wx-sky',
    minzoom: 8,
    layout: {
      'icon-image': ['concat', 'srr-sky-', ['get', 'kind']],
      'icon-anchor': 'left',
      'icon-offset': [8, 0],
      // Hidden where a rain column or another icon is in the way.
      'icon-allow-overlap': false,
    },
    paint: { 'icon-opacity': dim },
  });
  map.addLayer({
    id: 'wx-rain',
    type: 'symbol',
    source: 'wx-rain',
    minzoom: 7,
    layout: {
      'icon-image': [
        'concat',
        'srr-rain-',
        ['to-string', ['get', 'tenths']],
        ['case', ['get', 'day'], '', '-n'],
      ],
      'icon-anchor': 'bottom',
      'icon-offset': [0, -10],
      // Always shown: a few, and what the map is for here.
      'icon-allow-overlap': true,
    },
    paint: { 'icon-opacity': dim },
  });
}

export function setWeather(map: maplibregl.Map, w: WeatherMap | null) {
  map.getSource<maplibregl.GeoJSONSource>('wx-rain')?.setData(w?.rain ?? EMPTY);
  map.getSource<maplibregl.GeoJSONSource>('wx-sky')?.setData(w?.sky ?? EMPTY);
}
