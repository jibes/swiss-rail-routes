// GPX 1.1: one track, one segment per section that has geometry.
import type { Connection } from '../model';

const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

export function toGpx(tourName: string, chain: Connection[]): string {
  const segs = chain
    .flatMap((c) => c.sections)
    .filter((s) => s.geometry && s.geometry.length > 1)
    .map(
      (s) =>
        '<trkseg>' +
        s
          .geometry!.map(([lon, lat]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`)
          .join('') +
        '</trkseg>',
    );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="swiss-rail-routes" xmlns="http://www.topografix.com/GPX/1/1">' +
    `<trk><name>${xml(tourName)}</name>${segs.join('')}</trk></gpx>\n`
  );
}
