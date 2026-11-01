import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { delayMin, parseJourney } from '../src/core/ojp/journey';
import { journeyQueryOf, journeyRequestXml, parseJourneyQuery } from '../src/core/ojp/request';

describe('journey (TripInfo) request', () => {
  it('splits a section journey id and builds the request', () => {
    const q = journeyQueryOf('2026-11-01:ch:1:sjyid:100001:726-001')!;
    expect(q).toEqual({ day: '2026-11-01', journey: 'ch:1:sjyid:100001:726-001' });
    const xml = journeyRequestXml(q, new Date('2026-11-01T12:00:00Z'), 'srr');
    expect(xml).toContain('<OJPTripInfoRequest>');
    expect(xml).toContain('<JourneyRef>ch:1:sjyid:100001:726-001</JourneyRef>');
    expect(xml).toContain('<OperatingDayRef>2026-11-01</OperatingDayRef>');
  });

  it('validates untrusted input', () => {
    expect(parseJourneyQuery({ journey: 'ch:1:sjyid:100001:726-001', day: '2026-11-01' })).toEqual({
      journey: 'ch:1:sjyid:100001:726-001',
      day: '2026-11-01',
    });
    expect(parseJourneyQuery({ journey: '<x/>', day: '2026-11-01' })).toBe('journey');
    expect(parseJourneyQuery({ journey: 'ch:1:sjyid:1', day: 'today' })).toBe('day');
    expect(journeyQueryOf('nonsense')).toBeNull();
  });
});

describe('parseJourney on a recorded running train', () => {
  const s = parseJourney(readFileSync('tests/fixtures/ojp/tripinfo/running.xml', 'utf8'));

  it('lists served calls, then those to come, with estimates', () => {
    expect(s.cancelled).toBe(false);
    expect(s.calls.length).toBeGreaterThan(3);
    const firstOnward = s.calls.findIndex((c) => !c.passed);
    expect(firstOnward).toBeGreaterThan(0);
    expect(s.calls.slice(firstOnward).every((c) => !c.passed)).toBe(true);
    expect(s.calls[0]).toMatchObject({ key: 'ch:1:sloid:6302', name: 'St. Gallen', platform: '1' });
    expect(delayMin(s.calls[0]!, 'dep')).toBe(3);
  });

  it('reports 0 when no estimate is known', () => {
    expect(delayMin({ dep: '2026-11-01T10:00:00Z' }, 'dep')).toBe(0);
  });
});
