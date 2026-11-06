import { describe, expect, it } from 'vitest';
import { legLinks, sbbLink, uicOf } from '../src/core/export/sbb';

describe('prices on SBB', () => {
  it('a stop by its UIC number: SLOID 7000 is Bern, 8507000; a platform its station', () => {
    expect(uicOf('ch:1:sloid:7000')).toBe('8507000');
    expect(uicOf('ch:1:sloid:7000:0:12345')).toBe('8507000');
    expect(uicOf('8301003')).toBe('8301003');
    expect(uicOf('de:08111:6115')).toBeUndefined();
  });

  it('SBB’s own deep link: stops by number, the Swiss date and time in quotes', () => {
    const url = sbbLink(
      { stopRef: 'ch:1:sloid:7000', name: 'Bern' },
      { stopRef: 'ch:1:sloid:9000', name: 'Chur' },
      '2026-11-07T08:32:00Z',
      'de',
    );
    expect(url.startsWith('https://www.sbb.ch/de?')).toBe(true);
    const p = new URL(url).searchParams;
    expect(JSON.parse(p.get('stops')!)).toEqual([
      { value: '8507000', type: 'ID', label: 'Bern' },
      { value: '8509000', type: 'ID', label: 'Chur' },
    ]);
    expect(p.get('date')).toBe('"2026-11-07"');
    // 08:32 UTC in November is 09:32 in Switzerland.
    expect(p.get('time')).toBe('"09:32"');
  });

  it('one per leg, from its first ride to its last, walks left out', () => {
    const ride = (a: string, b: string, dep: string) => ({
      mode: 'rail' as const,
      from: { stopRef: `ch:1:sloid:${a}`, name: a, dep },
      to: { stopRef: `ch:1:sloid:${b}`, name: b, arr: dep },
      intermediate: [],
    });
    const walk = {
      mode: 'walk' as const,
      from: { stopRef: 'x', name: 'x' },
      to: { stopRef: 'y', name: 'y' },
      intermediate: [],
    };
    const links = legLinks([
      {
        legIndex: 0,
        dep: '',
        arr: '',
        transfers: 1,
        sections: [
          walk,
          ride('1', '2', '2026-11-07T08:00:00Z'),
          ride('2', '3', '2026-11-07T09:00:00Z'),
        ],
      },
    ] as never);
    expect(links.map((l) => [l.from, l.to])).toEqual([['1', '3']]);
  });
});
