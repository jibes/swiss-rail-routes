import { describe, expect, it } from 'vitest';
import type { LineRow } from '../src/core/rows';
import { parseWeather, rowWeather, weatherDays, weatherPoints } from '../src/core/weather';
import { conn, index, ride } from './helpers/timetable';

// Open-Meteo's answer for two places (its documented form: one object each, in the order asked).
const hours = (day: string) =>
  Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`);
const cell = (cloud: number[], rain: number[]) => ({
  latitude: 0,
  longitude: 0,
  hourly: {
    time: hours('2026-11-07'),
    cloud_cover: cloud,
    precipitation_probability: rain,
    is_day: hours('2026-11-07').map((_, h) => (h >= 6 && h < 16 ? 1 : 0)),
  },
});
const flat = (v: number) => Array.from({ length: 24 }, () => v);
const STM = { lat: 46.4983, lon: 9.8459 };
const TIR = { lat: 46.2163, lon: 10.1676 };

describe('weather along a trip', () => {
  // St. Moritz sunny and dry; Tirano rain at 13–15 UTC (14:00–16:00 Swiss time).
  const tiranoRain = flat(0).map((_, h) => (h >= 13 && h <= 14 ? 70 : 10));
  const f = parseWeather([cell(flat(10), flat(0)), cell(flat(80), tiranoRain)], [STM, TIR]);

  it('reads an hour for a place, by its forecast cell', () => {
    expect(f.at(STM, Date.parse('2026-11-07T11:30:00Z'))).toEqual({
      cloud: 0.1,
      rain: 0,
      day: true,
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
