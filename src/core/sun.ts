// Sunset after the sunrise equation used by NOAA's simplified calculator (~1 min accuracy).
import type { LatLon } from './model';

const RAD = Math.PI / 180;
const J2000 = 2451545;
const UNIX_EPOCH_JD = 2440587.5;
const DAY_MS = 86_400_000;
/** Sun centre 0.833° below the horizon: refraction plus the solar disc's radius. */
const H0 = -0.833 * RAD;

/**
 * Sunset at `at` on the local calendar day `date` (`YYYY-MM-DD`).
 * Returns null when the sun does not set (polar day / night; never in Switzerland).
 */
export function sunset(date: string, at: LatLon): Date | null {
  return sunTimes(date, at)?.set ?? null;
}

/** Sunrise and sunset at `at` on `date` (UTC calendar day); null where the sun does not set. */
export function sunTimes(date: string, at: LatLon): { rise: Date; set: Date } | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const jdNoon = Date.UTC(y, m - 1, d, 12) / DAY_MS + UNIX_EPOCH_JD;
  const n = Math.ceil(jdNoon - J2000 - 0.5 + 0.0008);
  const jStar = n - at.lon / 360;
  const M = ((357.5291 + 0.98560028 * jStar) % 360) * RAD;
  const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
  const lambda = ((M / RAD + C + 180 + 102.9372) % 360) * RAD;
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);
  const sinDec = Math.sin(lambda) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const phi = at.lat * RAD;
  const cosW = (Math.sin(H0) - Math.sin(phi) * sinDec) / (Math.cos(phi) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const half = Math.acos(cosW) / RAD / 360;
  const at_ = (j: number) => new Date(Math.round((j - UNIX_EPOCH_JD) * DAY_MS));
  return { rise: at_(jTransit - half), set: at_(jTransit + half) };
}

/** True when `passAt` is later than sunset − `marginMin` at that place (SPEC §3). */
export function isAfterSunset(passAt: Date, date: string, at: LatLon, marginMin = 15): boolean {
  const s = sunset(date, at);
  return s !== null && passAt.getTime() > s.getTime() - marginMin * 60_000;
}
