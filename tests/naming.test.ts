import { describe, expect, it } from 'vitest';
import { addWaypoint, insertTemplate, newTour, setRoundTrip, setStop } from '../src/core/edit';
import { autoName } from '../src/core/naming';
import { index, ref, templates } from './helpers/timetable';

const st = (name: string) => ({ stopRef: ref(name), name });
const stop = (r: string) => index.byRef(r);
const tpl = (id: string) => templates.find((t) => t.id === id)!;

describe('autoName', () => {
  it('one way: start → end, or with up to two stations between', () => {
    const t = addWaypoint(newTour('t', '2026-11-07', st('Interlaken Ost')), st('Kleine Scheidegg'));
    expect(autoName(t, stop)).toBe('Interlaken Ost → Kleine Scheidegg');
    const three = addWaypoint(
      addWaypoint(newTour('t', '2026-11-07', st('Zürich HB')), st('Luzern')),
      st('Bern'),
    );
    expect(autoName(three, stop)).toBe('Zürich HB → Luzern → Bern');
  });

  it('round trip: the stops with the longest stays, in route order', () => {
    let t = insertTemplate(newTour('t', '2026-11-07', st('Zürich HB')), tpl('voralpen-express'));
    t = insertTemplate(insertTemplate(t, tpl('bruenig')), tpl('bergbahn-muerren'));
    t = setRoundTrip(t, true);
    const at = (n: string) => t.waypoints.findIndex((w) => w.name === n);
    t = setStop(setStop(t, at('Luzern'), true, 60), at('Mürren BLM'), true, 90);
    expect(autoName(t, stop)).toBe('Zürich HB ↺ Luzern · Mürren BLM');
  });

  it('a loop without stops: its turning point and its middle', () => {
    const t = setRoundTrip(
      insertTemplate(
        insertTemplate(newTour('t', '2026-11-07', st('Zürich HB')), tpl('albula')),
        tpl('bernina'),
      ),
      true,
    );
    expect(autoName(t, stop)).toBe('Zürich HB ↺ Chur · Tirano');
  });

  it('without coordinates still names start and end', () => {
    expect(autoName(newTour('t', '2026-11-07', st('Bern')))).toBe('Bern');
    expect(autoName(newTour('t', '2026-11-07'))).toBe('');
  });
});
