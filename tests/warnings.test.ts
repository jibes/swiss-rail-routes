// A train's notice counts against the plan only when it concerns the stretch you ride.
import { describe, expect, it } from 'vitest';
import type { Connection, Section } from '../src/core/model';
import { placeByName, stopKey } from '../src/core/stops';
import { noticeStretch, onThisStretch, stretchOf, warningsFor } from '../src/core/warnings';
import { DATE, conn, ga, index, ride as tRide, templates } from './helpers/timetable';

const call = (name: string) => ({ stopRef: name, name });
const ride = (names: string[], notices: string[]): Section => ({
  mode: 'rail',
  from: call(names[0]!),
  to: call(names.at(-1)!),
  intermediate: names.slice(1, -1).map(call),
  situationIds: ['x'],
  notices,
});

describe('a notice and the stretch you ride', () => {
  it('reads the two ends a notice names, in each language', () => {
    expect(
      stretchOf('Der Bahnverkehr zwischen Lausanne und Genève-Aéroport ist eingeschränkt.'),
    ).toEqual(['Lausanne', 'Genève-Aéroport']);
    expect(stretchOf('Trafic interrompu entre Brig et Domodossola.')).toEqual([
      'Brig',
      'Domodossola',
    ]);
    expect(stretchOf('Traffico interrotto tra Bellinzona e Lugano.')).toEqual([
      'Bellinzona',
      'Lugano',
    ]);
    expect(stretchOf('Signal fault, delays expected.')).toBeUndefined();
  });
  it('the IC1 Bern–Zürich with works between Lausanne and Genève: not on your stretch', () => {
    const s = ride(
      ['Bern', 'Zürich HB'],
      ['Der Bahnverkehr zwischen Lausanne und Genève-Aéroport ist eingeschränkt.'],
    );
    expect(onThisStretch(s)).toBe(false);
  });
  it('an end you pass, or a notice naming no stretch: on your stretch', () => {
    // Without places to read it against (as before): one end you pass is enough.
    const s = ride(
      ['Interlaken West', 'Spiez', 'Bern'],
      ['Der Bahnverkehr zwischen Interlaken Ost und Interlaken West ist unterbrochen.'],
    );
    expect(onThisStretch(s)).toBe(true);
    expect(onThisStretch(ride(['Bern', 'Zürich HB'], ['Personenunfall, Verspätungen.']))).toBe(
      true,
    );
    // Notices with no text: as before, a disruption.
    expect(onThisStretch(ride(['Bern', 'Zürich HB'], []))).toBe(true);
  });
});

// Reported 4 Nov 2026: a notice was counted on a ride that shares only one end with its stretch.
describe('a notice read against the track you ride', () => {
  const st = (name: string) => index.search(name, 1)[0]!;
  const real = (names: string[], notice: string): Section => {
    const c = (n: string) => ({ stopRef: st(n).ref, name: st(n).name });
    return {
      mode: 'rail',
      from: c(names[0]!),
      to: c(names.at(-1)!),
      intermediate: names.slice(1, -1).map(c),
      situationIds: ['x'],
      notices: [notice],
    };
  };
  const places = { stop: (r: string) => index.byRef(stopKey(r)), place: placeByName(index) };
  const lausanneGeneve = 'Der Bahnverkehr zwischen Lausanne und Genève-Aéroport ist eingeschränkt.';

  it('the VAE St. Gallen–Luzern via Küssnacht and Luzern–Ebikon: elsewhere', () => {
    const vae = real(
      ['St. Gallen', 'Rapperswil SG', 'Arth-Goldau', 'Küssnacht am Rigi', 'Luzern'],
      'Der Bahnverkehr zwischen Luzern und Ebikon ist unterbrochen.',
    );
    expect(onThisStretch(vae, places)).toBe(false);
  });
  it('the IC1 Lausanne → Zürich and Lausanne–Genève-Aéroport: elsewhere', () => {
    const ic1 = real(['Lausanne', 'Fribourg/Freiburg', 'Bern', 'Zürich HB'], lausanneGeneve);
    expect(onThisStretch(ic1, places)).toBe(false);
    const ir90 = real(['Martigny', 'Montreux', 'Vevey', 'Lausanne'], lausanneGeneve);
    expect(onThisStretch(ir90, places)).toBe(false);
  });
  it('a ride over the stretch: on it, in each language', () => {
    expect(
      onThisStretch(real(['Genève-Aéroport', 'Genève', 'Lausanne'], lausanneGeneve), places),
    ).toBe(true);
    const fr = 'Trafic perturbé entre Lausanne et Genève-Aéroport.';
    const it_ = 'Traffico limitato tra Lausanne e Genève-Aéroport.';
    const en = 'Restricted service between Lausanne and Genève-Aéroport.';
    for (const n of [fr, it_, en])
      expect(onThisStretch(real(['Genève-Aéroport', 'Lausanne'], n), places)).toBe(true);
  });
  it('an express passing the other end without stopping: on it', () => {
    // Bern → Zürich HB without a stop passes Olten on its track; "Olten–Zürich" concerns it.
    const ic = real(
      ['Bern', 'Zürich HB'],
      'Der Bahnverkehr zwischen Olten und Zürich HB ist eingeschränkt.',
    );
    const at = (n: string): [number, number] => [st(n).lon, st(n).lat];
    ic.geometry = [at('Bern'), at('Burgdorf'), at('Olten'), at('Aarau'), at('Zürich HB')];
    expect(onThisStretch(ic, places)).toBe(true);
    // Without its track, straight from Bern to Zürich misses Olten by 24 km: not counted.
    expect(onThisStretch({ ...ic, geometry: undefined }, places)).toBe(false);
  });
  it('a ride that starts where the stretch ends: elsewhere', () => {
    const s = real(
      ['Interlaken West', 'Spiez', 'Bern'],
      'Der Bahnverkehr zwischen Interlaken Ost und Interlaken West ist unterbrochen.',
    );
    expect(onThisStretch(s, places)).toBe(false);
  });
});

describe('replacement buses and timed changes (reported 4 Nov 2026)', () => {
  const ctx = (ids: string[]) => ({
    legIndex: 0,
    date: DATE,
    ticket: 'GA' as const,
    templates: templates.filter((t) => ids.includes(t.id)),
    ga,
    stop: (r: string) => index.byRef(stopKey(r)),
  });
  const types = (c: Connection, ids: string[]) => warningsFor(c, ctx(ids)).map((w) => w.type);

  it('a replacement bus on a scenic line says the stretch is by road', () => {
    const ev = conn(
      tRide('EV 3', [
        ['Thusis', '10:31'],
        ['Filisur', '11:02'],
      ]),
    );
    const w = warningsFor(ev, ctx(['albula']));
    expect(w.find((x) => x.type === 'replacement-bus')).toMatchObject({
      severity: 'warn',
      key: 'wReplacementBus',
      params: { from: 'Thusis', to: 'Filisur', line: 'Albula' },
    });
    // The same bus where no scenic line is ridden, or a train on the line: nothing of the kind.
    expect(types(ev, [])).not.toContain('replacement-bus');
    const train = conn(
      tRide('IR 38', [
        ['Thusis', '10:31'],
        ['Filisur', '11:02'],
      ]),
    );
    expect(types(train, ['albula'])).not.toContain('replacement-bus');
  });

  it('a tight change the operator times is said as timed, not as a risk', () => {
    const c = conn(
      tRide('PB 2461', [
        ['Lauterbrunnen', '10:00'],
        ['Grütschalp', '10:04'],
      ]),
      tRide('R 66', [
        ['Grütschalp', '10:07'],
        ['Mürren BLM', '10:21'],
      ]),
    );
    const w = warningsFor(c, ctx(['bergbahn-muerren']));
    expect(w.find((x) => x.type === 'timed-change')).toMatchObject({
      severity: 'info',
      params: { at: 'Grütschalp', min: 3 },
    });
    expect(types(c, ['bergbahn-muerren'])).not.toContain('tight-transfer');
    // Without the line, the same 3 minutes are a tight change.
    expect(types(c, [])).toContain('tight-transfer');
  });
});

// Reported on the MCP, 5 Nov 2026: "Information zu IR 26 und IR 46 ab Erstfeld" was said as a
// disruption of the whole IR46 Zürich HB–Bellinzona. "From X" is the stretch from X onwards.
describe('a notice from (or up to) a station', () => {
  const gotthard = ['Zürich HB', 'Zug', 'Arth-Goldau', 'Erstfeld', 'Göschenen', 'Bellinzona'];
  const ab = 'Information zu IR 26 und IR 46 ab Erstfeld';
  it('reads "from X" and "up to X" in each language', () => {
    expect(noticeStretch(ab)).toEqual({ from: 'Erstfeld' });
    expect(noticeStretch('Perturbation dès Erstfeld.')).toEqual({ from: 'Erstfeld' });
    expect(noticeStretch('Perturbazione da Erstfeld.')).toEqual({ from: 'Erstfeld' });
    expect(noticeStretch('Disruption from Erstfeld.')).toEqual({ from: 'Erstfeld' });
    expect(noticeStretch('Einschränkungen bis Erstfeld.')).toEqual({ to: 'Erstfeld' });
    expect(noticeStretch('Zwischen Thusis und Preda: Ersatzbus.')).toEqual({
      from: 'Thusis',
      to: 'Preda',
    });
  });
  const st = (name: string) => index.search(name, 1)[0]!;
  const real = (names: string[], notice: string): Section => {
    const c = (n: string) => ({ stopRef: st(n).ref, name: st(n).name });
    return {
      mode: 'rail',
      from: c(names[0]!),
      to: c(names.at(-1)!),
      intermediate: names.slice(1, -1).map(c),
      situationIds: ['x'],
      notices: [notice],
    };
  };
  const places = { stop: (r: string) => index.byRef(stopKey(r)), place: placeByName(index) };
  it('on a ride past X; elsewhere on one that ends before it or at it', () => {
    expect(onThisStretch(real(gotthard, ab), places)).toBe(true);
    expect(onThisStretch(real(['Zürich HB', 'Zug', 'Arth-Goldau'], ab), places)).toBe(false);
    expect(onThisStretch(real(['Zürich HB', 'Arth-Goldau', 'Erstfeld'], ab), places)).toBe(false);
    for (const n of ['Perturbation dès Erstfeld.', 'Perturbazione da Erstfeld.'])
      expect(onThisStretch(real(['Zürich HB', 'Arth-Goldau'], n), places)).toBe(false);
    // A ride that starts beyond X is on the stretch from X onwards.
    expect(onThisStretch(real(['Göschenen', 'Bellinzona'], ab), places)).toBe(true);
    // Up to X: a ride starting at X has left the stretch behind; one ending before it is on it.
    const bis = 'Einschränkungen bis Erstfeld.';
    expect(onThisStretch(real(['Erstfeld', 'Bellinzona'], bis), places)).toBe(false);
    expect(onThisStretch(real(['Zürich HB', 'Arth-Goldau'], bis), places)).toBe(true);
    // Without places to read it against: a ride that ends at X is elsewhere, else as before.
    expect(onThisStretch(ride(['Zürich HB', 'Erstfeld'], [ab]))).toBe(false);
    expect(onThisStretch(ride(['Zürich HB', 'Arth-Goldau'], [ab]))).toBe(true);
  });
  it('the warning names the stretch, not the whole ride', () => {
    const s: Section = {
      ...tRide('IR 46', [
        ['Zürich HB', '08:09'],
        ['Arth-Goldau', '08:40'],
        ['Erstfeld', '09:00'],
        ['Bellinzona', '10:10'],
      ]),
      situationIds: ['x'],
      notices: [ab],
    };
    const w = warningsFor(conn(s), {
      legIndex: 0,
      date: DATE,
      ticket: 'GA',
      templates: [],
      ga,
      stop: (r) => index.byRef(r),
      place: placeByName(index),
    }).find((x) => x.type === 'disruption')!;
    expect(w).toMatchObject({ key: 'wDisruptionFrom', params: { at: 'Erstfeld' } });
  });
});

describe('a notice read without the track (the MCP drops tracks; retest N3, 5 Nov 2026)', () => {
  it('Chur → Albula on 6 Nov: "zwischen Thusis und Preda" is not on the IR38 from Preda', async () => {
    const { plan } = await import('../src/core/planner/plan');
    const { ojpFor } = await import('./acceptance/ojp');
    const { insertTemplate, newTour } = await import('./helpers/edit');
    const { ref } = await import('./helpers/timetable');
    const albula = templates.find((x) => x.id === 'albula')!;
    const route = {
      ...insertTemplate(newTour('b', '2026-11-06', { stopRef: ref('Chur'), name: 'Chur' }), albula),
      anchor: { departAt: '08:00' },
    };
    const o = ojpFor('B1R');
    const r = await plan(route, {
      ...o,
      // As the MCP gets them: no tracks; stops looked up by their ref as it comes.
      fetchTrips: async (q) =>
        (await o.fetchTrips(q)).map((c) => ({
          ...c,
          sections: c.sections.map((s) => ({ ...s, geometry: undefined })),
        })),
      templates,
      ga,
      stop: (x: string) => index.byRef(x),
      place: placeByName(index),
    });
    const best = r.recommended!;
    const ir38 = best.connections[0]!.sections.findIndex((s) => s.line === 'IR38');
    expect(ir38).toBeGreaterThan(0);
    const on = best.warnings.filter((w) => w.sectionIndex === ir38);
    expect(on.map((w) => w.type)).toEqual(['disruption-away']);
  });
});
