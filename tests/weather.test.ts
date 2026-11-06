import { describe, expect, it } from 'vitest';
import type { LineRow } from '../src/core/rows';
import {
  parseWeather,
  rowWeather,
  skyKind,
  tempText,
  weatherDays,
  weatherPoints,
} from '../src/core/weather';
import { weatherMap } from '../src/core/weatherMap';
import { conn, index, ride } from './helpers/timetable';

// Open-Meteo's answer for two places (its documented form: one object each, in the order asked).
const hours = (day: string) =>
  Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`);
const cell = (cloud: number[], rain: number[], temp?: number[]) => ({
  latitude: 0,
  longitude: 0,
  hourly: {
    time: hours('2026-11-07'),
    cloud_cover: cloud,
    precipitation_probability: rain,
    is_day: hours('2026-11-07').map((_, h) => (h >= 6 && h < 16 ? 1 : 0)),
    ...(temp ? { temperature_2m: temp } : {}),
  },
});
const flat = (v: number) => Array.from({ length: 24 }, () => v);
const STM = { lat: 46.4983, lon: 9.8459 };
const TIR = { lat: 46.2163, lon: 10.1676 };

describe('weather along a trip', () => {
  // St. Moritz sunny and dry; Tirano rain at 13–15 UTC (14:00–16:00 Swiss time).
  const tiranoRain = flat(0).map((_, h) => (h >= 13 && h <= 14 ? 70 : 10));
  const f = parseWeather(
    [cell(flat(10), flat(0), flat(-2.4)), cell(flat(80), tiranoRain, flat(9))],
    [STM, TIR],
  );

  it('reads an hour for a place, by its forecast cell', () => {
    expect(f.at(STM, Date.parse('2026-11-07T11:30:00Z'))).toEqual({
      cloud: 0.1,
      rain: 0,
      day: true,
      temp: -2.4,
    });
    // A stop 1 km away is the same cell.
    expect(f.at({ lat: 46.505, lon: 9.84 }, Date.parse('2026-11-07T11:30:00Z'))?.cloud).toBe(0.1);
    expect(f.at(TIR, Date.parse('2026-11-07T20:00:00Z'))?.day).toBe(false);
    expect(f.at({ lat: 47.4, lon: 8.5 }, Date.parse('2026-11-07T11:30:00Z'))).toBeUndefined();
  });

  const place = (ref: string) => {
    const s = index.byRef(ref);
    return s && { lat: s.lat, lon: s.lon };
  };
  const bernina = ride('R 1631', [
    ['St. Moritz', '12:15'],
    ['Poschiavo', '13:58'],
    ['Tirano', '14:32'],
  ]);
  const rows: LineRow[] = [
    {
      type: 'station',
      name: 'St. Moritz',
      key: bernina.from.stopRef,
      role: 'start',
      dep: bernina.from.dep,
    },
    { type: 'ride', section: bernina, leg: 0, sectionIndex: 0 },
    {
      type: 'station',
      name: 'Tirano',
      key: bernina.to.stopRef,
      role: 'stop',
      stay: 120,
      arr: bernina.to.arr,
      dep: '2026-11-07T15:32:00Z',
    },
  ];
  void conn;

  it('a stay: its highest chance of rain while you are there; a ride: at every stop it calls at', () => {
    const w = rowWeather(rows, f, place);
    expect(w[0]).toMatchObject({ rain: 0, day: true });
    expect(w[0]!.cloud).toBeCloseTo(0.1);
    // 14:32–16:32 Swiss time in Tirano: the 70 % hours.
    expect(w[2]!.rain).toBe(0.7);
    // Poschiavo has no forecast asked here: the ride's stops between say none for it.
    expect(w[1]!.mids).toEqual([undefined]);
  });

  it('asks each place once, rounded, and the trip’s day', () => {
    const pts = weatherPoints(rows, place);
    expect(pts.length).toBe(3);
    expect(weatherDays(rows)).toEqual({ from: '2026-11-07', to: '2026-11-07' });
  });
});

describe('a recorded Open-Meteo answer (through the Worker, 6 Nov 2026)', () => {
  it('reads it as the made-up one: St. Moritz at 1818 m and Tirano, hour by hour', async () => {
    const { readFileSync } = await import('node:fs');
    const { gunzipSync } = await import('node:zlib');
    const answer = JSON.parse(
      gunzipSync(
        readFileSync('tests/fixtures/weather/stmoritz-tirano-2026-11-07.json.gz'),
      ).toString(),
    ) as unknown;
    const f = parseWeather(answer, [STM, TIR]);
    const at10 = Date.parse('2026-11-07T10:30:00Z');
    expect(f.at(STM, at10)).toEqual({ cloud: 0.46, rain: 0.18, day: true });
    expect(f.at(TIR, at10)).toEqual({ cloud: 0.86, rain: 0.15, day: true });
    expect(f.source).toBe('open-meteo');
    expect(parseWeather([{ source: 'met.no', hourly: { time: [] } }], [STM]).source).toBe('met.no');
  });
});

describe('the sky in words and on the map (0.38.0)', () => {
  it('four kinds of sky; temperatures with a true minus sign', () => {
    expect(skyKind({ cloud: 0.1, rain: 0, day: true })).toBe('sun');
    expect(skyKind({ cloud: 0.5, rain: 0, day: true })).toBe('part');
    expect(skyKind({ cloud: 0.9, rain: 0.8, day: true })).toBe('cloud');
    expect(skyKind({ cloud: 0, rain: 0, day: false })).toBe('night');
    expect(tempText(-2.4)).toBe('\u22122°');
    expect(tempText(-0.4)).toBe('0°');
    expect(tempText(12.6)).toBe('13°');
  });

  const place = (ref: string) => {
    const s = index.byRef(ref);
    return s && { lat: s.lat, lon: s.lon };
  };
  const bernina = ride('R 1631', [
    ['St. Moritz', '12:15'],
    ['Poschiavo', '13:58'],
    ['Tirano', '14:32'],
  ]);
  const rows: LineRow[] = [
    {
      type: 'station',
      name: 'St. Moritz',
      key: bernina.from.stopRef,
      role: 'start',
      dep: bernina.from.dep,
    },
    { type: 'ride', section: bernina, leg: 0, sectionIndex: 0 },
    { type: 'station', name: 'Tirano', key: bernina.to.stopRef, role: 'end', arr: bernina.to.arr },
  ];

  it('rain above the stations where it is likely, the ride’s sky by its middle stop, temperatures by key', () => {
    const w = [
      { cloud: 0.1, rain: 0.05, day: true, temp: -2 },
      { cloud: 0.5, rain: 0.7, day: true },
      { cloud: 0.9, rain: 0.66, day: false, temp: 9 },
    ];
    const m = weatherMap(rows, w, place, Date.parse(bernina.from.dep!) + 60_000);
    // Dry St. Moritz has no column; Tirano 7 tenths, at night.
    expect(m.rain.features.map((x) => x.properties)).toEqual([
      { row: 2, tenths: 7, day: false, past: false },
    ]);
    const p = place(bernina.intermediate[0]!.stopRef)!;
    expect(m.sky.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { row: 1, kind: 'part', past: false },
      },
    ]);
    expect(m.temps.get(bernina.from.stopRef)).toBe(-2);
    expect(m.temps.get(bernina.to.stopRef)).toBe(9);
    expect(m.temps.get('name:Tirano')).toBe(9);
  });
});
