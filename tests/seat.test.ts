// The side to sit on per ride, flipped when a line is ridden against its chain's order.
import { describe, expect, it } from 'vitest';
import type { RouteTemplate } from '../src/core/data';
import type { Section } from '../src/core/model';
import { seatOn } from '../src/core/seat';
import templatesJson from '../src/data/templates.json';

const templates = (templatesJson as { templates: RouteTemplate[] }).templates;
const by = (id: string) => templates.find((t) => t.id === id)!;
const stationsOf = (id: string, ...names: string[]) =>
  names.map((n) => by(id).chain.find((s) => s.name === n)!);
const ride = (calls: { ref: string; name: string }[], mode: Section['mode'] = 'rail'): Section => {
  const c = calls.map((x) => ({ stopRef: x.ref, name: x.name }));
  return { mode, from: c[0]!, to: c.at(-1)!, intermediate: c.slice(1, -1) };
};

describe('which side to sit on', () => {
  it('the Albula and Bernina lines: right in their order, left the other way', () => {
    const albula = stationsOf('albula', 'Chur', 'Thusis', 'Filisur', 'Preda', 'St. Moritz');
    expect(seatOn(ride(albula), templates)).toBe('R');
    expect(seatOn(ride([...albula].reverse()), templates)).toBe('L');
    const bernina = stationsOf('bernina', 'St. Moritz', 'Pontresina', 'Alp Grüm', 'Tirano');
    expect(seatOn(ride(bernina), templates)).toBe('R');
    expect(seatOn(ride([...bernina].reverse()), templates)).toBe('L');
  });

  it('only part of a line: Lötschberg from Goppenstein, Mürren from Grütschalp', () => {
    const top = stationsOf('loetschberg-bergstrecke', 'Spiez', 'Frutigen', 'Kandersteg');
    expect(seatOn(ride(top), templates)).toBeUndefined();
    const down = stationsOf('loetschberg-bergstrecke', 'Kandersteg', 'Goppenstein', 'Brig');
    expect(seatOn(ride(down), templates)).toBe('R');
    expect(seatOn(ride([...down].reverse()), templates)).toBe('L');
    const cable = stationsOf('bergbahn-muerren', 'Lauterbrunnen', 'Grütschalp');
    expect(seatOn(ride(cable, 'cableCar'), templates)).toBeUndefined();
    const train = stationsOf('bergbahn-muerren', 'Grütschalp', 'Mürren BLM');
    expect(seatOn(ride(train), templates)).toBe('L');
    expect(seatOn(ride([...train].reverse()), templates)).toBe('R');
  });

  it('down from Rigi Kulm to Vitznau: right; up: left', () => {
    const down = stationsOf('rigi-vitznau', 'Rigi Kulm', 'Rigi Staffel', 'Vitznau');
    expect(seatOn(ride(down, 'cog'), templates)).toBe('R');
    expect(seatOn(ride([...down].reverse(), 'cog'), templates)).toBe('L');
  });

  it('no tip off the lines, on a walk, or on a line without an agreed side', () => {
    expect(
      seatOn(
        ride([
          { ref: 'ch:1:sloid:3000', name: 'Zürich HB' },
          { ref: 'ch:1:sloid:7000', name: 'Bern' },
        ]),
        templates,
      ),
    ).toBeUndefined();
    const albula = stationsOf('albula', 'Chur', 'Thusis');
    expect(seatOn(ride(albula, 'walk'), templates)).toBeUndefined();
    const brunig = by('bruenig').chain.slice(0, 3);
    expect(seatOn(ride(brunig), templates)).toBeUndefined();
  });
});
