// A leg with many vias that OJP cannot answer in one go (504 after 25 s, log of 6 Nov 2026):
// asked at its vias instead, as when no answer passes them all.
import { describe, expect, it } from 'vitest';
import type { TripQuery } from '../src/core/ojp/request';
import { plan } from '../src/core/planner/plan';
import { addWaypoint, newTour } from './helpers/edit';
import { conn, DATE, deps, ref, ride } from './helpers/timetable';

const st = (name: string) => ({ stopRef: ref(name), name });

describe('a leg too much for one request', () => {
  const tour = {
    ...addWaypoint(
      addWaypoint(addWaypoint(newTour('t', DATE, st('Zürich HB')), st('Zug')), st('Arth-Goldau')),
      st('Erstfeld'),
    ),
    anchor: { departAt: '08:00' },
  };
  // Asked at its vias: from the start by the first to the second, then on to the end.
  const d = deps([
    conn(
      ride('IR 70', [
        ['Zürich HB', '08:04'],
        ['Zug', '08:25'],
        ['Arth-Goldau', '08:50'],
      ]),
    ),
    conn(
      ride('IR 26', [
        ['Arth-Goldau', '08:57'],
        ['Erstfeld', '09:20'],
      ]),
    ),
  ]);

  it('the one request with all vias timing out, the leg is asked at its vias', async () => {
    const asked: string[] = [];
    const fetchTrips = async (q: TripQuery) => {
      asked.push(`${q.origin.name}>${q.destination.name}/${q.vias.length}`);
      if (q.vias.length >= 2) throw new Error('504 upstream timeout');
      return d.tt.fetchTrips(q);
    };
    const r = await plan(tour, { ...d.deps, fetchTrips });
    expect(asked[0]).toBe('Zürich HB>Erstfeld/2');
    const rides = r.recommended!.connections.flatMap((c) => c.sections).map((s) => s.from.name);
    expect(rides).toEqual(['Zürich HB', 'Arth-Goldau']);
  });

  it('a request stopped (an edit) stops the plan', async () => {
    const fetchTrips = async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    await expect(plan(tour, { ...d.deps, fetchTrips })).rejects.toThrow('aborted');
  });
});
