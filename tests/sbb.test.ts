import { describe, expect, it } from 'vitest';
import { legLinks, sbbLink, uicOf } from '../src/core/export/sbb';

describe('prices on SBB', () => {
  it('a stop by its UIC number: SLOID 7000 is Bern, 8507000; a platform its station', () => {
    expect(uicOf('ch:1:sloid:7000')).toBe('8507000');
    expect(uicOf('ch:1:sloid:7000:0:12345')).toBe('8507000');
    expect(uicOf('8301003')).toBe('8301003');
    expect(uicOf('de:08111:6115')).toBeUndefined();
  });

  it('as sbb.ch writes its own: Name_I<number>~…, the date in quotes, the time as HH_MM', () => {
    const url = sbbLink(
      [
        { stopRef: 'ch:1:sloid:3000', name: 'Zürich HB' },
        { stopRef: 'ch:1:sloid:1120', name: 'Lausanne' },
        { stopRef: 'ch:1:sloid:1008', name: 'Genève' },
      ],
      '2026-11-08T13:46:00Z',
    );
    // The address sbb.ch made for this very search (6 Nov 2026), less its `day`.
    expect(url).toBe(
      'https://www.sbb.ch/en?stops=Z%C3%BCrich+HB_I8503000~Lausanne_I8501120~Gen%C3%A8ve_I8501008&date=%222026-11-08%22&time=14_46&moment=dep&via=1',
    );
    expect(
      sbbLink(
        [
          { stopRef: 'ch:1:sloid:7000', name: 'Bern' },
          { stopRef: 'de:08111:6115', name: 'Stuttgart' },
        ],
        '2026-11-08T13:46:00Z',
        'de',
      ),
    ).toBe(
      'https://www.sbb.ch/de?stops=Bern_I8507000~Stuttgart&date=%222026-11-08%22&time=14_46&moment=dep',
    );
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
