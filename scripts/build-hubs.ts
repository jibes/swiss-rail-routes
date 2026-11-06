// The hub cities abroad (0.33.1): where Transitous names a station only "Hauptbahnhof" or "Gare"
// (the German feed's own names), the app names it after the city it lies in. Built once from
// Transitous' station search, one request a second: each city's main station, kept only when its
// areas name the city. NODE_USE_ENV_PROXY=1 npx tsx scripts/build-hubs.ts
import { writeFileSync } from 'node:fs';

const CITIES = [
  // Germany
  'Aachen',
  'Augsburg',
  'Bamberg',
  'Basel Bad',
  'Berlin',
  'Bielefeld',
  'Bochum',
  'Bonn',
  'Braunschweig',
  'Bremen',
  'Chemnitz',
  'Darmstadt',
  'Dortmund',
  'Dresden',
  'Duisburg',
  'Düsseldorf',
  'Erfurt',
  'Erlangen',
  'Essen',
  'Frankfurt (Main)',
  'Freiburg (Breisgau)',
  'Friedrichshafen',
  'Fulda',
  'Göttingen',
  'Hagen',
  'Halle (Saale)',
  'Hamburg',
  'Hannover',
  'Heidelberg',
  'Heilbronn',
  'Ingolstadt',
  'Jena',
  'Kaiserslautern',
  'Karlsruhe',
  'Kassel',
  'Kempten',
  'Kiel',
  'Koblenz',
  'Köln',
  'Konstanz',
  'Leipzig',
  'Lindau',
  'Lübeck',
  'Magdeburg',
  'Mainz',
  'Mannheim',
  'Memmingen',
  'Mönchengladbach',
  'München',
  'Münster',
  'Nürnberg',
  'Offenburg',
  'Oldenburg',
  'Osnabrück',
  'Passau',
  'Pforzheim',
  'Regensburg',
  'Rosenheim',
  'Rostock',
  'Saarbrücken',
  'Schwerin',
  'Singen',
  'Stuttgart',
  'Trier',
  'Tübingen',
  'Ulm',
  'Wiesbaden',
  'Würzburg',
  'Wuppertal',
  // Austria
  'Bregenz',
  'Feldkirch',
  'Graz',
  'Innsbruck',
  'Klagenfurt',
  'Linz',
  'Salzburg',
  'Villach',
  'Wien',
  // France
  'Annecy',
  'Avignon',
  'Besançon',
  'Bordeaux',
  'Chambéry',
  'Dijon',
  'Grenoble',
  'Lille',
  'Lyon',
  'Marseille',
  'Metz',
  'Montpellier',
  'Mulhouse',
  'Nancy',
  'Nantes',
  'Nice',
  'Paris',
  'Reims',
  'Rennes',
  'Strasbourg',
  'Toulouse',
  'Évian-les-Bains',
  'Thonon-les-Bains',
  'Annemasse',
  // Italy
  'Bergamo',
  'Bologna',
  'Bolzano',
  'Brescia',
  'Como',
  'Domodossola',
  'Firenze',
  'Genova',
  'Milano',
  'Napoli',
  'Novara',
  'Padova',
  'Roma',
  'Torino',
  'Trento',
  'Varese',
  'Venezia',
  'Verona',
  'Tirano',
  // Benelux and beyond
  'Amsterdam',
  'Antwerpen',
  'Brussel',
  'Den Haag',
  'Liège',
  'Luxembourg',
  'Rotterdam',
  'Utrecht',
  'Praha',
  'Budapest',
  'Ljubljana',
  'Zagreb',
  'Bratislava',
];

const UA = 'Viadukt (https://github.com/jibes/swiss-rail-routes)';
const RAIL = new Set(['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'REGIONAL_RAIL', 'RAIL', 'NIGHT_RAIL']);
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\(.*\)$/, '');
const out: { name: string; lat: number; lon: number }[] = [];
for (const city of CITIES) {
  const url = `https://api.transitous.org/api/v1/geocode?${new URLSearchParams({ text: city, type: 'STOP' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const hits = (await res.json()) as {
    name: string;
    lat: number;
    lon: number;
    modes?: string[];
    areas?: { name: string }[];
  }[];
  const key = fold(city.split(' ')[0]!);
  const hit = hits.find(
    (h) =>
      h.modes?.some((m) => RAIL.has(m)) &&
      (h.areas ?? []).some((a) => fold(a.name).startsWith(key)),
  );
  if (hit)
    out.push({
      name: city.replace(/ Bad$/, ''),
      lat: +hit.lat.toFixed(4),
      lon: +hit.lon.toFixed(4),
    });
  console.log(city, hit ? `${hit.name} ${hit.lat},${hit.lon}` : '—');
  await new Promise((r) => setTimeout(r, 1000));
}
writeFileSync('src/data/hubs.json', JSON.stringify(out, null, 0) + '\n');
console.log(out.length, 'hubs');
