// How much a notice weighs (retest, 5 Nov 2026: a 1-min shift "ab Erstfeld" was an error, as the
// Albula's closure). OJP's own Severity/Priority say "normal"/3 on every recorded situation, so
// the operator's words decide.
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Section } from '../src/core/model';
import { gradeNotice } from '../src/core/noticeGrade';
import { parseTrips } from '../src/core/ojp/parse';
import { warningsFor } from '../src/core/warnings';
import { DATE, conn, ga, index, ride, templates } from './helpers/timetable';

const DIR = 'tests/fixtures/ojp';

/** Every situation in the recordings, by its headline, with the grade the parser gave it. */
function recorded() {
  const out = new Map<string, string>();
  // Trip answers only: the map planner's departures are another delivery.
  for (const tour of readdirSync(DIR).filter((d) => d !== 'departures')) {
    let files: string[];
    try {
      files = readdirSync(`${DIR}/${tour}`).filter((f) => f.endsWith('.xml.gz'));
    } catch {
      continue;
    }
    for (const f of files)
      for (const c of parseTrips(gunzipSync(readFileSync(`${DIR}/${tour}/${f}`)).toString()))
        for (const s of c.sections)
          (s.notices ?? []).forEach((n, i) => out.set(n, s.noticeInfo?.[i]?.grade ?? '?'));
  }
  return out;
}

describe('a notice graded by its words', () => {
  const all = recorded();
  const gradeOf = (part: string) => [...all].find(([n]) => n.includes(part))?.[1];

  it('the recorded ones', () => {
    // Closed: the Albula Thusis–Preda (6–13 Nov 2026), Luzern–Ebikon.
    expect(gradeOf('zwischen Thusis und Preda ist unterbrochen')).toBe('error');
    expect(gradeOf('zwischen Luzern und Ebikon ist unterbrochen')).toBe('error');
    // Runs, but restricted: Lausanne–Genève-Aéroport, the PEBEX rerouted.
    expect(gradeOf('Lausanne und Genève-Aéroport ist eingeschränkt')).toBe('warn');
    expect(gradeOf('Linie PEBEX ist eingeschränkt')).toBe('warn');
    // Advice: the Centovalli's "reservation strongly recommended".
    expect(gradeOf('Reservierung dringend empfohlen')).toBe('info');
  });

  it('the Erstfeld headline is information, a closure in any language an error', () => {
    expect(gradeNotice('Information zu IR 26 und IR 46 ab Erstfeld')).toBe('info');
    expect(gradeNotice('Le trafic ferroviaire entre Lausanne et Renens est interrompu.')).toBe(
      'error',
    );
    expect(gradeNotice('Il traffico ferroviario tra Locarno e Camedo è limitato.')).toBe('warn');
    expect(gradeNotice('Train services between A and B are cancelled.')).toBe('error');
    // The consequences count too: "irregular" in the headline, a stretch cancelled below it.
    expect(
      gradeNotice(
        'Unregelmässiger Betrieb zwischen Martigny und Vallorcine (F) [Bahn].',
        'die Verbindung zwischen Martigny und Les Marécottes entfällt',
      ),
    ).toBe('error');
  });
});

describe('the warning says what the notice weighs', () => {
  const ctx = { legIndex: 0, date: DATE, ticket: 'GA' as const, templates, ga, stop: index.byRef };
  const noticed = (s: Section, text: string, grade?: 'info' | 'warn' | 'error'): Section => ({
    ...s,
    situationIds: ['x'],
    notices: [text],
    noticeInfo: [grade ? { grade } : {}],
  });
  const disruption = (s: Section) =>
    warningsFor(conn(s), ctx).find((w) => w.type === 'disruption' || w.type === 'notice')?.severity;
  const typeOf = (s: Section) =>
    warningsFor(conn(s), ctx).find((w) => w.legIndex === 0 && w.sectionIndex === 0)?.type;

  it('information is info, a closure an error, a plan saved before grading still an error', () => {
    const r = ride('IR 26', [
      ['Arth-Goldau', '09:00'],
      ['Erstfeld', '09:40'],
      ['Bellinzona', '10:50'],
    ]);
    expect(disruption(noticed(r, 'Information zu IR 26 und IR 46 ab Erstfeld', 'info'))).toBe(
      'info',
    );
    expect(disruption(noticed(r, 'Information zu IR 26 und IR 46', 'error'))).toBe('error');
    expect(disruption(noticed(r, 'Information zu IR 26 und IR 46'))).toBe('error');
  });

  it('information is a notice, reservation advice its own; neither says disruption (round 3)', () => {
    const r = ride('IR 26', [
      ['Arth-Goldau', '09:00'],
      ['Erstfeld', '09:40'],
      ['Bellinzona', '10:50'],
    ]);
    const info = warningsFor(
      conn(noticed(r, 'Information zu IR 26 und IR 46 ab Erstfeld', 'info')),
      ctx,
    )[0]!;
    expect(info).toMatchObject({ type: 'notice', key: 'wNoticeFrom', severity: 'info' });
    expect(typeOf(noticed(r, 'Die Linien IR 26 Reservierung dringend empfohlen.', 'info'))).toBe(
      'reservation-advised',
    );
    expect(typeOf(noticed(r, 'Der Bahnverkehr ist unterbrochen.', 'error'))).toBe('disruption');
  });

  it('a closure ridden by its own replacement bus is a warning: the way round is the plan', () => {
    const bus = ride(
      'EV 4',
      [
        ['Thusis', '09:00'],
        ['Preda', '10:00'],
      ],
      { mode: 'bus' },
    );
    expect(disruption(noticed(bus, 'Der Bahnverkehr ist unterbrochen.', 'error'))).toBe('warn');
  });
});
