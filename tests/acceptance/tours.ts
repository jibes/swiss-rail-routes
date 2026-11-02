// The acceptance tours of SPEC §8, built with the same edits as the app.
import {
  addWaypoint,
  insertTemplate,
  newTour,
  setDwell,
  setRoundTrip,
  setStop,
} from '../helpers/edit';
import type { Tour } from '../../src/core/model';
import { index, templates } from '../helpers/timetable';

const st = (name: string) => {
  const s = index.search(name, 1)[0];
  if (s?.name !== name) throw new Error(`no stop ${name}`);
  return { stopRef: s.ref, name };
};
const tpl = (id: string) => templates.find((t) => t.id === id)!;
const at = (tour: Tour, name: string) => tour.waypoints.findLastIndex((w) => w.name === name);
const stopAt = (tour: Tour, name: string, min: number) =>
  setDwell(setStop(tour, at(tour, name), true), at(tour, name), min);

export function acceptanceTours(date: string): Record<string, Tour> {
  const start = (name: string, time: string): Tour => ({
    ...newTour('t', date, st(name)),
    anchor: { departAt: time },
  });

  // Stops are set last: a waypoint is only a stop while it is not the end.
  let t1 = insertTemplate(start('Zürich HB', '07:00'), tpl('albula'));
  t1 = addWaypoint(addWaypoint(t1, st('Pontresina')), st('Alp Grüm'));
  t1 = insertTemplate(addWaypoint(t1, st('Pontresina')), tpl('vereina'), true);
  t1 = stopAt(setRoundTrip(t1, true), 'Alp Grüm', 30);

  let t2 = addWaypoint(addWaypoint(start('Zürich HB', '07:30'), st('Chur')), st('Ilanz'));
  t2 = setRoundTrip(addWaypoint(insertTemplate(t2, tpl('oberalp')), st('Göschenen')), true);

  let t3 = insertTemplate(start('Zürich HB', '07:00'), tpl('voralpen-express'));
  t3 = insertTemplate(insertTemplate(t3, tpl('bruenig')), tpl('bergbahn-muerren'));
  t3 = setRoundTrip(addWaypoint(addWaypoint(t3, st('Interlaken Ost')), st('Bern')), true);
  t3 = stopAt(stopAt(t3, 'Mürren BLM', 60), 'Luzern', 60);

  let t4 = insertTemplate(start('Zürich HB', '08:00'), tpl('rigi-arth'));
  t4 = insertTemplate(insertTemplate(t4, tpl('rigi-vitznau')), tpl('lake-lucerne'));
  t4 = stopAt(setRoundTrip(t4, true), 'Rigi Kulm', 45);

  const t5 = addWaypoint(start('Interlaken Ost', '09:00'), st('Kleine Scheidegg'));

  const t6 = addWaypoint(
    insertTemplate(start('Zürich HB', '08:00'), tpl('gotthard-bergstrecke')),
    st('Lugano'),
  );

  // T5 an hour later: what the timeline's "Later" button asks for (e2e/acceptance.spec.ts).
  const t5later: Tour = { ...t5, anchor: { departAt: '10:00' } };

  return { T1: t1, T2: t2, T3: t3, T4: t4, T5: t5, T5L: t5later, T6: t6 };
}
