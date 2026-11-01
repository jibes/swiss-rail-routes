// A route's default name: its start, at most two stations in between, its end.
// The two: where you get off (longest stay first), then spread out (farthest from the start and
// from the one picked: a loop's turning point and its middle); shown in route order. A round trip: "Start ↺ A · B".
import type { LatLon, Tour } from './model';
import { stopKey } from './stops';
import { isRoundTrip } from './tour';

const km = (a: LatLon, b: LatLon) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371;
};

export function autoName(tour: Tour, stop?: (ref: string) => LatLon | undefined): string {
  const wps = tour.waypoints;
  if (!wps.length) return '';
  const start = wps[0]!;
  if (wps.length === 1) return start.name;
  const end = wps.at(-1)!;
  const closed = isRoundTrip(tour);
  const home = stop?.(stopKey(start.stopRef));
  const seen = new Set([stopKey(start.stopRef), stopKey(end.stopRef)]);
  const candidates = wps
    .slice(1, -1)
    .map((w, i) => ({ w, i, at: stop?.(stopKey(w.stopRef)) }))
    .filter(({ w }) => {
      const k = stopKey(w.stopRef);
      return !seen.has(k) && !!seen.add(k);
    });
  const off = (w: (typeof wps)[number]) => w.kind === 'stop' || w.kind === 'turnaround';
  // Where you get off comes first, longest stay first.
  const picked = candidates
    .filter((c) => off(c.w))
    .sort((a, b) => b.w.dwellMin - a.w.dwellMin)
    .slice(0, 2);
  // Then spread out: each next one farthest from the start and from those picked.
  while (picked.length < 2) {
    const anchors = [home, ...picked.map((p) => p.at)].filter((x): x is LatLon => !!x);
    const rest = candidates.filter((c) => !picked.includes(c) && c.at);
    if (!rest.length || !anchors.length) break;
    const best = rest.reduce((a, b) =>
      Math.min(...anchors.map((x) => km(x, b.at!))) > Math.min(...anchors.map((x) => km(x, a.at!)))
        ? b
        : a,
    );
    picked.push(best);
  }
  const inner = picked.sort((a, b) => a.i - b.i).map((x) => x.w.name);
  if (closed) return inner.length ? `${start.name} ↺ ${inner.join(' · ')}` : `${start.name} ↺`;
  return [start.name, ...inner, end.name].join(' → ');
}
