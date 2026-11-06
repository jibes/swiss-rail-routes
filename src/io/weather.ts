// Weather along a trip (0.37.0) through the Worker (Open-Meteo, MET Norway when it refuses).
// Asked only for a trip shown, up to AHEAD_DAYS ahead, at most once an hour (kept here, and the
// Worker keeps it an hour too). A failure is said by nothing: no stripe that time.
import { parseWeather, type Forecast, type WeatherQuery } from '../core/weather';
import { log } from './log';

const kept = new Map<string, { at: number; f: Forecast }>();
const KEEP_MS = 3_600_000;

export async function fetchWeather(q: WeatherQuery, signal?: AbortSignal): Promise<Forecast> {
  const key = JSON.stringify(q);
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.f;
  const url = import.meta.env.VITE_OJP_URL;
  if (!url) throw new Error('no worker');
  const res = await fetch(`${url.replace(/[/]$/, '')}/weather`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(q),
    signal,
  });
  if (!res.ok) {
    log('weather.fail', { status: res.status, points: q.points.length });
    throw new Error(String(res.status));
  }
  const f = parseWeather(await res.json(), q.points);
  log('weather', {
    points: q.points.length,
    source: f.source,
    cache: res.headers.get('X-Cache') ?? undefined,
  });
  kept.set(key, { at: Date.now(), f });
  return f;
}
