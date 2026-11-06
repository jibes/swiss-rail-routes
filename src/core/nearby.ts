// The map planner's tap anywhere (pure): the stops near that point to choose from. Stations
// (rail, cable car, boat) from further away, bus and tram stops only close by, so a tap in the
// countryside offers the station, a tap in a village its bus stop. How far follows the zoom: a
// tenth of the map's width, so zoomed in it is the street, zoomed out the region.
import { stopKind, type Stop, type StopKind, type StopSearch } from './stops';

export interface NearChoice extends Stop {
  km: number;
  kind: StopKind;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** How far stations and other stops are looked for, by the map's width in km. */
export function nearbyKm(viewKm: number) {
  return { stations: clamp(viewKm / 10, 1, 15), others: clamp(viewKm / 30, 0.3, 2) };
}

export function nearbyChoices(
  index: Pick<StopSearch, 'near'>,
  at: { lat: number; lon: number },
  viewKm: number,
  max = 5,
): NearChoice[] {
  const km = nearbyKm(viewKm);
  const stations = index
    .near(at, km.stations)
    .slice(0, 3)
    .map((s) => ({ ...s, kind: stopKind(s) }));
  const seen = new Set(stations.map((s) => s.ref));
  const others = index
    .near(at, km.others, true)
    .filter((s) => !seen.has(s.ref))
    .map((s) => ({ ...s, kind: stopKind(s) }))
    .filter((s) => s.kind === 'bus' || s.kind === 'tram');
  // Stations first; the rest filled with the stops close by, then more stations if room is left.
  const room = Math.max(0, max - stations.length);
  return [...stations, ...others.slice(0, room)];
}
