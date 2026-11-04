// The GA data against rides as OJP gives them: a stretch is matched by the stops the ride itself
// calls at, so a fare named after a place's main station must be keyed on the stop the line
// leaves from (the Schilthornbahn from Mürren (Schilthornbahn), not Mürren BLM).
import { describe, expect, it } from 'vitest';
import type { GaData } from '../src/core/data';
import type { Section } from '../src/core/model';
import { gaRuleOf } from '../src/core/warnings';
import gaJson from '../src/data/ga.json';

const ga = gaJson as unknown as GaData;
const call = (sloid: number, name: string) => ({ stopRef: `ch:1:sloid:${sloid}`, name });
const ride = (mode: Section['mode'], ...calls: ReturnType<typeof call>[]): Section => ({
  mode,
  from: calls[0]!,
  to: calls.at(-1)!,
  intermediate: calls.slice(1, -1),
});

describe('GA cover on the summit lines', () => {
  it('Mürren to Birg by the Schilthornbahn: half fare with a GA, either way', () => {
    const up = ride('cableCar', call(7455, 'Mürren (Schilthornbahn)'), call(7456, 'Birg'));
    expect(gaRuleOf(up, ga)).toBe('half');
    const down = ride('cableCar', call(7456, 'Birg'), call(7455, 'Mürren (Schilthornbahn)'));
    expect(gaRuleOf(down, ga)).toBe('half');
  });

  it('the train into Mürren is no part of it', () => {
    const train = ride('rail', call(7380, 'Grütschalp'), call(7379, 'Mürren BLM'));
    expect(gaRuleOf(train, ga)).toBeNull();
  });

  it('Gornergrat from Zermatt GGB and Pilatus from Alpnachstad PB, the stops they leave from', () => {
    const ids = (n: string) => ga.sections.find((x) => x.names.includes(n));
    expect(ids('Zermatt GGB')?.names).toContain('Gornergrat');
    expect(ids('Alpnachstad PB')?.names).toContain('Pilatus Kulm');
    expect(ids('Zermatt')).toBeUndefined();
  });
});
