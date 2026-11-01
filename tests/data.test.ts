import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GaData, RouteTemplate, Segment } from '../src/core/data';
import { LANGS } from '../src/i18n';
import { createStopSearch, type StopIndexFile } from '../src/core/stops';
import gaJson from '../src/data/ga.json';
import segmentsJson from '../src/data/segments.json';
import templatesJson from '../src/data/templates.json';

const templates = templatesJson.templates as RouteTemplate[];
const segments = segmentsJson.segments as Segment[];
const ga = gaJson as GaData;
const index = createStopSearch(
  JSON.parse(readFileSync('public/data/stops.v1.json', 'utf8')) as StopIndexFile,
);
const MODES = ['rail', 'cog', 'cableCar', 'boat', 'bus'];

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
};

describe('templates.json', () => {
  it('has unique ids', () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });

  for (const t of templates) {
    describe(t.id, () => {
      it('names every stop as the stop index does', () => {
        expect(t.chain.length).toBeGreaterThanOrEqual(2);
        for (const s of t.chain) expect(index.byRef(s.ref)?.name, s.ref).toBe(s.name);
        expect(new Set(t.chain.map((s) => s.ref)).size).toBe(t.chain.length);
      });

      it('must-pass stops lie on the chain, avoided segments exist', () => {
        const chain = t.chain.map((s) => s.ref);
        for (const r of t.mustPass) expect(chain).toContain(r);
        for (const id of t.avoid) expect(segments.map((s) => s.id)).toContain(id);
        for (const m of t.modes) expect(MODES).toContain(m);
        if (t.seat) expect(['L', 'R']).toContain(t.seat);
      });

      it('highlights lie near the chain', () => {
        const stops = t.chain.map((s) => index.byRef(s.ref)!);
        for (const h of t.highlights) {
          const nearest = Math.min(...stops.map((s) => km(s, h)));
          expect(nearest, h.id).toBeLessThan(15);
        }
      });

      it('season notes exist in every language', () => {
        if (!t.season) return;
        for (const m of t.season.months) expect(m >= 1 && m <= 12).toBe(true);
        for (const l of LANGS) expect(t.season.note[l]?.length, l).toBeGreaterThan(0);
      });
    });
  }
});

describe('segments.json', () => {
  it('resolves every stop and keeps the ends apart', () => {
    for (const s of segments) {
      for (const r of [...s.a, ...s.b, ...s.via])
        expect(index.byRef(r), `${s.id} ${r}`).toBeTruthy();
      expect(
        s.a.some((r) => s.b.includes(r)),
        s.id,
      ).toBe(false);
    }
  });
});

describe('ga.json', () => {
  it('resolves every section', () => {
    for (const x of ga.sections) {
      expect(index.byRef(x.from)?.name).toBe(x.names[0]);
      expect(index.byRef(x.to)?.name).toBe(x.names[1]);
      expect(['half', 'reduced', 'none']).toContain(x.rule);
    }
  });
});
