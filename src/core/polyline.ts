// Tracks made small enough for a link: Douglas–Peucker simplification, then Google's encoded
// polyline format (5 decimals, ~1 m). Pure.

type Pt = [number, number]; // [lon, lat] (GeoJSON order)

/** Drops points closer than `tol` degrees to the line through their neighbours. */
export function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (far > tol && worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function encodeNumber(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

export function encodePolyline(points: Pt[]): string {
  let lat = 0;
  let lon = 0;
  let out = '';
  for (const [x, y] of points) {
    const la = Math.round(y * 1e5);
    const lo = Math.round(x * 1e5);
    out += encodeNumber(la - lat) + encodeNumber(lo - lon);
    lat = la;
    lon = lo;
  }
  return out;
}

export function decodePolyline(s: string): Pt[] {
  const out: Pt[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < s.length + 1);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}
