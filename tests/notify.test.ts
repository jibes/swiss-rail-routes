import { describe, expect, it } from 'vitest';
import { insertTemplate, newTour } from './helpers/edit';
import { noticesFor } from '../src/core/notify';
import { zurichDateTime } from '../src/core/ojp/request';
import { newTrip } from '../src/core/trip';
import { DATE, conn, index, ref, ride, templates } from './helpers/timetable';

const at = (hhmm: string) => Date.parse(zurichDateTime(`${DATE}T${hhmm}`));
const albula = templates.find((t) => t.id === 'albula')!;
const route = insertTemplate(newTour('r', DATE, { stopRef: ref('Chur'), name: 'Chur' }), albula);
const chain = [
  conn(
    ride(
      'RE 1',
      [
        ['Chur', '15:58'],
        ['Thusis', '16:25'],
        ['Filisur', '16:50'],
        ['Bergün/Bravuogn', '17:00'],
        ['Preda', '17:10'],
        ['St. Moritz', '17:58'],
      ],
      {
        journey: 'j1',
      },
    ),
  ),
];
const trip = newTrip(
  'trip-1',
  route,
  [],
  { connections: chain, warnings: [], score: 0, dep: chain[0]!.dep, arr: chain[0]!.arr },
  new Date(0),
);
const stop = (r: string) => index.byRef(r);

describe('noticesFor', () => {
  it('10 min before departure, 5 before the exit, 10 before a highlight with the sunset near', () => {
    const list = noticesFor(trip, at('08:00'), templates, stop);
    const by = (k: string) => list.filter((n) => n.kind === k);
    expect(by('depart')).toHaveLength(1);
    expect(by('depart')[0]!.at).toBe(at('15:48'));
    expect(by('depart')[0]!.params).toMatchObject({
      line: 'RE 1',
      to: 'St. Moritz',
      time: '15:58',
    });
    expect(by('exit')[0]!.at).toBe(at('17:53'));
    const landwasser = by('highlight').find((n) => n.params.name === 'Landwasserviadukt')!;
    expect(landwasser.at).toBe(at('16:40')); // Filisur 16:50, nearest call
    expect(landwasser.params.side).toBe('R');
    expect(landwasser.params.sunset).toMatch(/^1[67]:\d\d$/); // Nov sunset ≈ 17:00, within an hour
    expect(list.map((n) => n.at)).toEqual([...list.map((n) => n.at)].sort((a, b) => a - b));
  });

  it("a highlight's side flips for the line ridden the other way", () => {
    const back = structuredClone(trip);
    const c = back.chain.connections[0]!;
    for (const x of c.sections) {
      [x.from, x.to] = [x.to, x.from];
      x.intermediate.reverse();
    }
    c.sections.reverse();
    const list = noticesFor(back, at('08:00'), templates, stop);
    const landwasser = list.find(
      (n) => n.kind === 'highlight' && n.params.name === 'Landwasserviadukt',
    );
    expect(landwasser?.params.side).toBe('L');
  });

  it('skips what is past, keeps ids stable', () => {
    const later = noticesFor(trip, at('16:00'), templates, stop);
    expect(later.some((n) => n.kind === 'depart')).toBe(false);
    const early = noticesFor(trip, at('08:00'), templates, stop);
    const exitId = (l: typeof early) => l.find((n) => n.kind === 'exit')!.id;
    expect(exitId(later)).toBe(exitId(early));
    expect(new Set(early.map((n) => n.id)).size).toBe(early.length);
  });

  it('a change of trains: each train its own departure and exit, ids distinct and 31-bit', () => {
    const two = [
      conn(
        ride('IR 70', [
          ['Zürich HB', '08:04'],
          ['Luzern', '08:45'],
        ]),
        ride('PE LIX', [
          ['Luzern', '08:51'],
          ['Interlaken Ost', '10:41'],
        ]),
      ),
    ];
    const t = newTrip(
      'trip-two',
      newTour('r2', DATE, { stopRef: ref('Zürich HB'), name: 'Zürich HB' }),
      [],
      { connections: two, warnings: [], score: 0, dep: two[0]!.dep, arr: two[0]!.arr },
      new Date(0),
    );
    const list = noticesFor(t, at('07:00'), templates, stop);
    expect(list.filter((n) => n.kind === 'depart').map((n) => n.params.time)).toEqual([
      '08:04',
      '08:51',
    ]);
    expect(list.filter((n) => n.kind === 'exit').map((n) => n.at)).toEqual([
      at('08:40'),
      at('10:36'),
    ]);
    expect(new Set(list.map((n) => n.id)).size).toBe(list.length);
    // Android notification ids are 32-bit signed integers.
    for (const n of list) expect(n.id > 0 && n.id < 2 ** 31).toBe(true);
  });

  it('the same train on both sides of a stop: no exit there, no departure from it', () => {
    const through = [
      conn(
        ride(
          'RE 1',
          [
            ['Chur', '15:58'],
            ['Filisur', '16:50'],
          ],
          { journey: 'j9' },
        ),
      ),
      conn(
        ride(
          'RE 1',
          [
            ['Filisur', '16:50'],
            ['St. Moritz', '17:58'],
          ],
          { journey: 'j9' },
        ),
      ),
    ];
    const t = newTrip(
      'trip-through',
      route,
      [],
      { connections: through, warnings: [], score: 0, dep: through[0]!.dep, arr: through[1]!.arr },
      new Date(0),
    );
    const list = noticesFor(t, at('08:00'), templates, stop);
    expect(list.filter((n) => n.kind === 'depart').map((n) => n.params.time)).toEqual(['15:58']);
    expect(list.filter((n) => n.kind === 'exit').map((n) => n.params.time)).toEqual(['17:58']);
  });
});
