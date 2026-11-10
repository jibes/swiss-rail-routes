// Several stops typed at once (0.47.0): split, matched to lines and stations, in the order typed.
import { describe, expect, it } from 'vitest';
import type { RouteTemplate } from '../src/core/data';
import { resolveTyped, splitTyped, type TypedDeps } from '../src/core/typedList';
import templatesJson from '../src/data/templates.json';

const lines = (templatesJson as unknown as { templates: RouteTemplate[] }).templates;
const at: Record<string, { lat: number; lon: number }> = {
  Zürich: { lat: 47.378, lon: 8.54 },
  Chur: { lat: 46.853, lon: 9.529 },
  'St. Moritz': { lat: 46.498, lon: 9.846 },
  Tirano: { lat: 46.216, lon: 10.168 },
  Landquart: { lat: 46.967, lon: 9.554 },
  Zernez: { lat: 46.699, lon: 10.093 },
  Bern: { lat: 46.949, lon: 7.439 },
};
const refOf = (n: string) => `ch:1:sloid:${n}`;
const byRef = new Map<string, { lat: number; lon: number }>();
for (const tp of lines)
  for (const c of tp.chain) {
    const p = Object.entries(at).find(([n]) => c.name.startsWith(n))?.[1];
    if (p) byRef.set(c.ref, p);
  }
for (const [n, p] of Object.entries(at)) byRef.set(refOf(n), p);
const deps: TypedDeps = {
  lines,
  names: (tp) => ({
    own: [tp.name, ...Object.values(tp.names ?? {})],
    products: [...(tp.products ?? [])],
  }),
  station: (text) => {
    const n = Object.keys(at).find((x) => x.toLowerCase().startsWith(text.toLowerCase()));
    return n ? { stopRef: refOf(n), name: n } : undefined;
  },
  stop: (ref) => byRef.get(ref),
};
const ZH = { stopRef: refOf('Zürich'), name: 'Zürich' };

describe('typed list', () => {
  it('splits on commas, plus, arrows and words, and reads the way back', () => {
    expect(splitTyped('Bernina + Albula, back via Vereina')).toEqual([
      { text: 'Bernina', back: false },
      { text: 'Albula', back: false },
      { text: 'Vereina', back: true },
    ]);
    expect(splitTyped('Chur -> Tirano then Bern')?.map((p) => p.text)).toEqual([
      'Chur',
      'Tirano',
      'Bern',
    ]);
    expect(splitTyped('Albula, back')).toEqual([
      { text: 'Albula', back: false },
      { text: '', back: true },
    ]);
    expect(splitTyped('Zürich HB')).toBeNull();
    expect(splitTyped('Chur, ')).toBeNull();
  });

  it('lines by name, stations by search, each line the way the list runs, home at the end', () => {
    const r = resolveTyped(splitTyped('Albula, Bernina, back via Vereina')!, deps, ZH, ZH);
    expect(r.missing).toEqual([]);
    expect(
      r.items.map((x) => (x.kind === 'line' ? `${x.template.id}:${x.from}>${x.to}` : x.stop.name)),
    ).toEqual([
      'albula:Chur>St. Moritz',
      'bernina:St. Moritz>Tirano',
      expect.stringMatching(/^vereina:/),
      'Zürich',
    ]);
    // Each line's start once: St. Moritz ends the Albula and starts the Bernina.
    const names = r.entries.map((e) => e.w.name);
    expect(names.filter((n) => n === 'St. Moritz')).toHaveLength(1);
    expect(names.at(-1)).toBe('Zürich');
  });

  it('a station named just so before a line starting so; what is not found is said', () => {
    const r = resolveTyped(splitTyped('Bern, Xyzzy')!, deps, ZH);
    expect(r.items).toEqual([{ kind: 'station', stop: { stopRef: refOf('Bern'), name: 'Bern' } }]);
    expect(r.missing).toEqual(['Xyzzy']);
    // Named trains: "Glacier Express" is a line it runs on.
    const g = resolveTyped(splitTyped('Glacier Express, Chur')!, deps, ZH);
    expect(g.items[0]).toMatchObject({ kind: 'line' });
  });
});
