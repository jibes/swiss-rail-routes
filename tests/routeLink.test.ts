import { describe, expect, it } from 'vitest';
import { addWaypoint, insertTemplate, newTour, setRoundTrip, setStop } from '../src/core/edit';
import { parseRoute, routeHash, tourHash } from '../src/core/export/routeLink';
import type { Tour } from '../src/core/model';
import { TEMPLATES } from '../src/data';

const names: Record<string, string> = {
  'ch:1:sloid:3000': 'Zürich HB',
  'ch:1:sloid:9000': 'Chur',
};
const ctx = {
  templates: TEMPLATES,
  name: (ref: string) =>
    names[ref] ?? TEMPLATES.flatMap((x) => x.chain).find((c) => c.ref === ref)?.name,
  today: '2026-11-14',
};
const read = (hash: string) => {
  const [path, q = ''] = hash.replace(/^#\/r\//, '').split('?');
  return parseRoute(path!, new URLSearchParams(q), ctx);
};

function sample(): Tour {
  let t = newTour('id1', '2026-11-21', { stopRef: 'ch:1:sloid:3000', name: 'Zürich HB' });
  t = addWaypoint(t, { stopRef: 'ch:1:sloid:9000', name: 'Chur' });
  t = setStop(t, 1, true, 60);
  t = insertTemplate(
    t,
    TEMPLATES.find((x) => x.id === 'albula')!,
  );
  t = setRoundTrip(t, true);
  return { ...t, name: 'Bündner Rundfahrt', ticket: 'Halbtax', anchor: { arriveBy: '19:30' } };
}

describe('route links', () => {
  it('reads back what it writes', () => {
    const t = sample();
    const { id: _id, ...rest } = t;
    expect(read(routeHash(t, true))).toEqual(rest);
    // Without `when` only the route comes back; date and time are the reader's defaults.
    expect(read(routeHash(t))).toMatchObject({ waypoints: rest.waypoints, date: '2026-11-14' });
  });

  it('is readable: slugs and SLOID numbers, defaults left out', () => {
    let t = newTour('x', '2026-11-14', { stopRef: 'ch:1:sloid:3000', name: 'Zürich HB' });
    t = addWaypoint(t, { stopRef: 'ch:1:sloid:9000', name: 'Chur' });
    expect(routeHash(t)).toBe('#/r/zurich-hb.3000~chur.9000');
    expect(routeHash(t, true)).toBe('#/r/zurich-hb.3000~chur.9000?d=2026-11-14');
  });

  it('a route address carries the route for other devices', () => {
    const t = sample();
    const hash = tourHash(t, '/plan');
    expect(hash.startsWith('#/tour/id1/plan?s=zurich-hb.3000~chur.9000.@albula~')).toBe(true);
    const q = new URLSearchParams(hash.split('?')[1]);
    const { id: _id, ...rest } = t;
    expect(parseRoute(q.get('s')!, q, ctx)).toEqual(rest);
  });

  it('expands a route template and fills in defaults', () => {
    const r = read('#/r/@bernina')!;
    expect(r.date).toBe('2026-11-14');
    expect(r.anchor).toEqual({ departAt: '08:00' });
    expect(r.waypoints[0]!.kind).toBe('start');
    expect(r.waypoints.at(-1)!.kind).toBe('end');
    expect(r.waypoints.every((w) => w.templateId === 'bernina')).toBe(true);
    expect(read('#/r/@bernina.r')!.waypoints[0]!.stopRef).toBe(r.waypoints.at(-1)!.stopRef);
  });

  it('keeps refs that are not SLOIDs, and names unknown stops from the slug', () => {
    const r = read('#/r/foo-bar.x8503000%2E1~chur.9000')!;
    expect(r.waypoints[0]).toMatchObject({ stopRef: '8503000.1', name: 'Foo Bar' });
  });

  it('rejects broken links', () => {
    expect(read('#/r/zurich')).toBeNull();
    expect(read('#/r/zurich-hb.3000')).toBeNull();
    expect(read('#/r/@nope~chur.9000')).toBeNull();
  });
});
