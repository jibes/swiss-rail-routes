// The weather of a trip's rows (0.37.0): asked when the trip is up to AHEAD_DAYS ahead and its
// times are known, again at most hourly; nothing while it plans, for a trip gone, or when asked
// and refused (the stripe just does not show).
import { useEffect, useState } from 'react';
import type { LineRow } from '../core/rows';
import {
  AHEAD_DAYS,
  rowWeather,
  weatherDays,
  weatherPoints,
  type Forecast,
  type RowWeather,
} from '../core/weather';
import { fetchWeather } from '../io/weather';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';

export interface TripWeather {
  rows: (RowWeather | undefined)[];
  source: Forecast['source'];
  /** When it was asked (ms). */
  at: number;
}

export type WeatherState = TripWeather | { far: string } | null;

const DAY = 86_400_000;

export function useWeather(rows: LineRow[], on: boolean): WeatherState {
  const index = useStopIndex();
  const now = useNow();
  const hour = Math.floor(now / 3_600_000);
  const place = (ref: string) => {
    const s = index?.byRef(ref);
    return s ? { lat: s.lat, lon: s.lon } : undefined;
  };
  const days = on ? weatherDays(rows) : undefined;
  const points = on && index && days ? weatherPoints(rows, place) : [];
  const start = days ? Date.parse(`${days.from}T00:00:00Z`) : NaN;
  const far = days && start - now > AHEAD_DAYS * DAY;
  const past = days && Date.parse(`${days.to}T23:59:59Z`) < now;
  const ask = days && points.length && !far && !past ? JSON.stringify({ points, ...days }) : '';
  const [got, setGot] = useState<{ key: string; f: Forecast; at: number } | null>(null);
  useEffect(() => {
    if (!ask) return;
    const abort = new AbortController();
    fetchWeather(JSON.parse(ask) as Parameters<typeof fetchWeather>[0], abort.signal).then(
      (f) => setGot({ key: ask, f, at: Date.now() }),
      () => undefined,
    );
    return () => abort.abort();
    // Again each hour: the forecast moves on.
  }, [ask, hour]);
  if (far && days) return { far: new Date(start - AHEAD_DAYS * DAY).toISOString().slice(0, 10) };
  if (!ask || !got || got.key !== ask || !index) return null;
  return { rows: rowWeather(rows, got.f, place), source: got.f.source, at: got.at };
}
