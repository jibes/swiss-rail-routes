import { describe, expect, it } from 'vitest';
import { insertTemplate, newTour } from '../src/core/edit';
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

  it('skips what is past, keeps ids stable', () => {
    const later = noticesFor(trip, at('16:00'), templates, stop);
    expect(later.some((n) => n.kind === 'depart')).toBe(false);
    const early = noticesFor(trip, at('08:00'), templates, stop);
    const exitId = (l: typeof early) => l.find((n) => n.kind === 'exit')!.id;
    expect(exitId(later)).toBe(exitId(early));
    expect(new Set(early.map((n) => n.id)).size).toBe(early.length);
  });
});
