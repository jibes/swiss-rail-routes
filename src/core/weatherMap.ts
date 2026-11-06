// The trip's weather on its map (0.38.0): rain at each station as a column above it, the sky of
// each ride beside its middle, and each named station's temperature. From the line's own rows and
// their weather, so the map asks nothing of its own. Pure.
import type { LatLon } from './model';
import type { LineRow } from './rows';
import { stopKey } from './stops';
import { RAIN_MIN, skyKind, type RowWeather, type SkyKind } from './weather';

type Pos = [number, number];
interface Point<P> {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: Pos };
  properties: P;
}
interface Collection<P> {
  type: 'FeatureCollection';
  features: Point<P>[];
}

export interface RainProps {
  /** Which row of the line, for its words. */
  row: number;
  /** The chance in tenths (2–10), the column's image. */
  tenths: number;
  day: boolean;
  /** Over by now (under way): dimmed, as on the line. */
  past: boolean;
}
export interface SkyProps {
  row: number;
  kind: SkyKind;
  past: boolean;
}

export interface WeatherMap {
  rain: Collection<RainProps>;
  sky: Collection<SkyProps>;
  /**
   * Each station's temperature by its key (`stopKey`) and by `name:<its name>`, for the names
   * already on the map: a row may carry the train's stop where the route has another ref.
   */
  temps: Map<string, number>;
}

const ms = (s?: string) => (s ? Date.parse(s) : NaN);

export function weatherMap(
  rows: LineRow[],
  weather: (RowWeather | undefined)[],
  place: (ref: string) => LatLon | undefined,
  now: number,
): WeatherMap {
  const where = (ref: string): Pos | undefined => {
    const p = place(stopKey(ref)) ?? place(ref);
    return p ? [p.lon, p.lat] : undefined;
  };
  const rain: Point<RainProps>[] = [];
  const sky: Point<SkyProps>[] = [];
  const temps = new Map<string, number>();
  rows.forEach((r, row) => {
    const w = weather[row];
    if (!w) return;
    if (r.type === 'station') {
      const at = where(r.key);
      const past = ms(r.dep ?? r.arr) < now;
      if (w.temp !== undefined)
        for (const k of [r.key, `name:${r.name}`]) if (!temps.has(k)) temps.set(k, w.temp);
      if (at && w.rain >= RAIN_MIN)
        rain.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: at },
          properties: { row, tenths: Math.min(10, Math.round(w.rain * 10)), day: w.day, past },
        });
      return;
    }
    // A ride's sky beside its middle stop (the middle of its ends when it has none between).
    const s = r.section;
    const calls = [s.from, ...s.intermediate, s.to];
    const mid = calls[Math.floor(calls.length / 2)]!;
    let at = calls.length > 2 ? where(mid.stopRef) : undefined;
    if (!at) {
      const a = where(s.from.stopRef);
      const b = where(s.to.stopRef);
      at = a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : undefined;
    }
    if (at)
      sky.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: at },
        properties: { row, kind: skyKind(w), past: ms(s.to.arr) < now },
      });
  });
  const fc = <P>(features: Point<P>[]): Collection<P> => ({ type: 'FeatureCollection', features });
  return { rain: fc(rain), sky: fc(sky), temps };
}
