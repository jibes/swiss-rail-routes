// Weather along a trip (0.37.0): the sky (cloud cover, day or night) and the chance of rain or
// snow at each place of the trip when you are there, from Open-Meteo (MeteoSwiss' models) through
// the Worker. The question (typed, checked here and in the Worker), the answer read, and each
// row of the line's weather. Pure.
import type { LatLon } from './model';
import type { LineRow } from './rows';
import { stopKey } from './stops';
import { sunTimes } from './sun';

export interface WeatherQuery {
  /** Where, rounded to `GRID`° (a forecast cell, and fewer distinct questions to cache). */
  points: LatLon[];
  /** The days asked, `YYYY-MM-DD` (UTC), at most two: a trip past midnight. */
  from: string;
  to: string;
}

/** 0.05° (about 4–5 km): one question for nearby stops, still the valley they lie in. */
export const GRID = 0.05;
export const MAX_POINTS = 40;
/** Forecasts are worth showing this many days ahead; further out, nothing. */
export const AHEAD_DAYS = 7;
/** Rain or snow is said from this chance; below it, nothing (a dry day looks clean). */
export const RAIN_MIN = 0.2;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const round = (x: number) => Math.round(x / GRID) * GRID;
export const gridPoint = (p: LatLon): LatLon => ({
  lat: Number(round(p.lat).toFixed(2)),
  lon: Number(round(p.lon).toFixed(2)),
});
const keyOf = (p: LatLon) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

export function parseWeatherQuery(v: unknown): WeatherQuery | string {
  if (!isObj(v) || !Array.isArray(v.points)) return 'points';
  if (v.points.length < 1 || v.points.length > MAX_POINTS) return 'points';
  const points: LatLon[] = [];
  for (const p of v.points) {
    if (!isObj(p) || typeof p.lat !== 'number' || typeof p.lon !== 'number') return 'points';
    // Europe and around, as the trips abroad reach.
    if (p.lat < 34 || p.lat > 72 || p.lon < -11 || p.lon > 40) return 'points';
    points.push(gridPoint({ lat: p.lat, lon: p.lon }));
  }
  if (typeof v.from !== 'string' || !DAY.test(v.from)) return 'from';
  if (typeof v.to !== 'string' || !DAY.test(v.to)) return 'to';
  const span = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
  if (!(span >= 0 && span <= 1)) return 'to';
  return { points, from: v.from, to: v.to };
}

/** Open-Meteo's address for a question: hourly cloud cover, chance of rain, day or night. */
export function weatherUrl(base: string, q: WeatherQuery): string {
  const p = new URLSearchParams({
    latitude: q.points.map((x) => x.lat).join(','),
    longitude: q.points.map((x) => x.lon).join(','),
    hourly: 'cloud_cover,precipitation_probability,is_day,temperature_2m',
    timezone: 'UTC',
    start_date: q.from,
    end_date: q.to,
  });
  return `${base.replace(/[/]$/, '')}/v1/forecast?${p}`;
}

export interface Sky {
  /** Cloud cover, 0 (clear) to 1 (overcast). */
  cloud: number;
  /** Chance of rain or snow, 0 to 1. */
  rain: number;
  day: boolean;
  /** Air temperature, °C, when the forecast gives one. */
  temp?: number;
}

export interface Forecast {
  /** Whose forecast: Open-Meteo's, or MET Norway's when Open-Meteo refused (credited then). */
  source: 'open-meteo' | 'met.no';
  /** The forecast's hour for a place (its grid cell) and time; none outside what was asked. */
  at: (p: LatLon, t: number) => Sky | undefined;
}

const nums = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : NaN)) : [];

/**
 * Open-Meteo's answer: one object per point (several points), or the object (one), in the order
 * asked; each its hourly times (UTC, `YYYY-MM-DDTHH:MM`) and values.
 */
export function parseWeather(answer: unknown, points: LatLon[]): Forecast {
  const list = Array.isArray(answer) ? answer : [answer];
  const cells = new Map<
    string,
    { t: number[]; cloud: number[]; rain: number[]; day: number[]; temp: number[] }
  >();
  let source: Forecast['source'] = 'open-meteo';
  list.forEach((x, i) => {
    const p = points[i];
    if (!p || !isObj(x) || !isObj(x.hourly) || !Array.isArray(x.hourly.time)) return;
    const h = x.hourly;
    if (x.source === 'met.no') source = 'met.no';
    cells.set(keyOf(gridPoint(p)), {
      t: (h.time as unknown[]).map((s) => (typeof s === 'string' ? Date.parse(`${s}Z`) : NaN)),
      cloud: nums(h.cloud_cover),
      rain: nums(h.precipitation_probability),
      day: nums(h.is_day),
      temp: nums(h.temperature_2m),
    });
  });
  return {
    source,
    at: (p, t) => {
      const c = cells.get(keyOf(gridPoint(p)));
      if (!c) return undefined;
      // The hour it falls in.
      const i = c.t.findIndex((x, j) => x <= t && (c.t[j + 1] ?? x + 3_600_000) > t);
      if (i < 0 || !Number.isFinite(c.cloud[i]!) || !Number.isFinite(c.rain[i]!)) return undefined;
      const temp = c.temp[i];
      return {
        cloud: c.cloud[i]! / 100,
        rain: c.rain[i]! / 100,
        day: c.day[i] !== 0,
        ...(temp !== undefined && Number.isFinite(temp) ? { temp } : {}),
      };
    },
  };
}

/** A row's weather: the sky and the highest chance of rain while you are there. */
export interface RowWeather extends Sky {
  /** The stops between of a ride, in order (shown when the ride's stops are open). */
  mids?: (Sky | undefined)[];
}

type Place = (ref: string) => LatLon | undefined;

/**
 * Where the rides' stops are, as their answers placed them (`StopCall.pos`), by key and by ref:
 * for stops the stop index does not list (St-Gervais-Les-Bains-Le Fayet), 0.42.0.
 */
export function positionsIn(rows: LineRow[]): Map<string, LatLon> {
  const out = new Map<string, LatLon>();
  for (const r of rows)
    if (r.type === 'ride')
      for (const c of [r.section.from, ...r.section.intermediate, r.section.to])
        if (c.pos) {
          const p = { lon: c.pos[0], lat: c.pos[1] };
          out.set(c.stopRef, p);
          out.set(stopKey(c.stopRef), p);
        }
  return out;
}

/** The stop index's place for a ref, else where the answer put it. */
export const placeWith = (index: Place, rows: LineRow[]): Place => {
  const known = positionsIn(rows);
  return (ref) => index(ref) ?? known.get(ref);
};

/** The places a trip asks about: its stations and the stops its trains call at, rounded, once. */
export function weatherPoints(rows: LineRow[], place: Place): LatLon[] {
  const seen = new Map<string, LatLon>();
  const add = (ref: string) => {
    const p = place(stopKey(ref)) ?? place(ref);
    if (!p) return;
    const g = gridPoint(p);
    if (!seen.has(keyOf(g))) seen.set(keyOf(g), g);
  };
  for (const r of rows) {
    if (r.type === 'station') add(r.key);
    else for (const c of [r.section.from, ...r.section.intermediate, r.section.to]) add(c.stopRef);
  }
  return [...seen.values()].slice(0, MAX_POINTS);
}

const ms = (s?: string) => (s ? Date.parse(s) : NaN);
const HOUR = 3_600_000;

/** Of several hours: cloud and temperature on average, rain at its highest, day when any is. */
function combine(xs: (Sky | undefined)[]): Sky | undefined {
  const got = xs.filter((x): x is Sky => !!x);
  if (!got.length) return undefined;
  const temps = got.flatMap((x) => (x.temp === undefined ? [] : [x.temp]));
  return {
    cloud: got.reduce((a, x) => a + x.cloud, 0) / got.length,
    rain: Math.max(...got.map((x) => x.rain)),
    day: got.some((x) => x.day),
    ...(temps.length ? { temp: temps.reduce((a, x) => a + x, 0) / temps.length } : {}),
  };
}

/**
 * Each row's weather: a station while you are there (a stay hour by hour), a ride at every stop
 * it calls at (rain its highest along the way) and each of those for the stops between.
 */
export function rowWeather(rows: LineRow[], f: Forecast, place: Place): (RowWeather | undefined)[] {
  const where = (ref: string) => place(stopKey(ref)) ?? place(ref);
  return rows.map((r): RowWeather | undefined => {
    if (r.type === 'station') {
      const p = where(r.key);
      const a = ms(r.arr ?? r.dep);
      const b = ms(r.dep ?? r.arr);
      if (!p || !Number.isFinite(a)) return undefined;
      const hours: (Sky | undefined)[] = [];
      for (let t = a; t <= (Number.isFinite(b) ? b : a); t += HOUR) hours.push(f.at(p, t));
      if (Number.isFinite(b) && b > a) hours.push(f.at(p, b));
      return combine(hours);
    }
    if (r.section.mode === 'walk') return undefined;
    const s = r.section;
    const at = (c: { stopRef: string; dep?: string; arr?: string }) => {
      const p = where(c.stopRef);
      const t = ms(c.dep ?? c.arr);
      return p && Number.isFinite(t) ? f.at(p, t) : undefined;
    };
    const mids = s.intermediate.map(at);
    const all = combine([at(s.from), ...mids, at(s.to)]);
    return all && { ...all, mids };
  });
}

/** The days a trip's rows run on (UTC), for the question: at most two. */
export function weatherDays(rows: LineRow[]): { from: string; to: string } | undefined {
  const ts = rows.flatMap((r) =>
    r.type === 'station' ? [ms(r.arr), ms(r.dep)] : [ms(r.section.from.dep), ms(r.section.to.arr)],
  );
  const ok = ts.filter(Number.isFinite);
  if (!ok.length) return undefined;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const from = day(Math.min(...ok));
  const last = day(Math.max(...ok));
  const next = day(Date.parse(from) + 86_400_000);
  return { from, to: last > next ? next : last };
}

/** MET Norway's address for one place (its Locationforecast, the complete form). */
export const metNoUrl = (base: string, p: LatLon) =>
  `${base.replace(/[/]$/, '')}/weatherapi/locationforecast/2.0/complete?lat=${p.lat}&lon=${p.lon}`;

/**
 * MET Norway's answers (one per place, in the order asked) in Open-Meteo's form, so the app reads
 * one form: cloud cover and its chance of rain where it gives one (the next hour's, else the next
 * six hours'), else one from the amount it expects; day by the sun (it says none).
 */
export function fromMetNo(answers: unknown[], q: WeatherQuery): unknown[] {
  const start = Date.parse(`${q.from}T00:00:00Z`);
  const end = Date.parse(`${q.to}T23:59:59Z`);
  return answers.map((a, i) => {
    const p = q.points[i]!;
    const series =
      isObj(a) && isObj(a.properties) && Array.isArray(a.properties.timeseries)
        ? (a.properties.timeseries as unknown[])
        : [];
    const time: string[] = [];
    const cloud: number[] = [];
    const rain: number[] = [];
    const day: number[] = [];
    const temp: number[] = [];
    for (const e of series) {
      if (!isObj(e) || typeof e.time !== 'string' || !isObj(e.data)) continue;
      const t = Date.parse(e.time);
      if (!(t >= start && t <= end)) continue;
      const d = e.data;
      const inst = isObj(d.instant) && isObj(d.instant.details) ? d.instant.details : {};
      const next = (k: string) =>
        isObj(d[k]) && isObj((d[k] as Record<string, unknown>).details)
          ? ((d[k] as Record<string, unknown>).details as Record<string, unknown>)
          : {};
      const n1 = next('next_1_hours');
      const n6 = next('next_6_hours');
      const prob = [n1.probability_of_precipitation, n6.probability_of_precipitation].find(
        (x) => typeof x === 'number',
      ) as number | undefined;
      const amount = [n1.precipitation_amount, n6.precipitation_amount].find(
        (x) => typeof x === 'number',
      ) as number | undefined;
      time.push(e.time.slice(0, 16));
      temp.push(typeof inst.air_temperature === 'number' ? inst.air_temperature : NaN);
      cloud.push(typeof inst.cloud_area_fraction === 'number' ? inst.cloud_area_fraction : NaN);
      rain.push(
        prob ??
          (amount === undefined
            ? NaN
            : amount >= 1
              ? 90
              : amount >= 0.3
                ? 70
                : amount > 0
                  ? 40
                  : 5),
      );
      const sun = sunTimes(e.time.slice(0, 10), p);
      day.push(sun && t >= sun.rise.getTime() && t < sun.set.getTime() ? 1 : 0);
    }
    return {
      latitude: p.lat,
      longitude: p.lon,
      source: 'met.no',
      hourly: {
        time,
        cloud_cover: cloud,
        precipitation_probability: rain,
        is_day: day,
        temperature_2m: temp,
      },
    };
  });
}

/** The stripe's colour for a sky: gold in sun, grey under cloud, dark at night. */
export function skyColour(s: Sky | undefined): string {
  if (!s) return 'transparent';
  if (!s.day) return '#3a4660';
  const mix = (a: number, b: number) => Math.round(a + (b - a) * Math.min(1, Math.max(0, s.cloud)));
  return `rgb(${mix(0xf2, 0xb9)}, ${mix(0xb7, 0xbc)}, ${mix(0x05, 0xc1)})`;
}

/** The sky in four kinds, as the line's words and the map's icons say it. */
export type SkyKind = 'sun' | 'part' | 'cloud' | 'night';
export const skyKind = (s: Sky): SkyKind =>
  !s.day ? 'night' : s.cloud >= 0.7 ? 'cloud' : s.cloud >= 0.3 ? 'part' : 'sun';

/** A temperature as said: whole degrees, a true minus sign (−2°, not -2°). */
export const tempText = (c: number) => {
  const n = Math.round(c);
  return `${n < 0 ? '\u2212' : ''}${Math.abs(n)}°`;
};
