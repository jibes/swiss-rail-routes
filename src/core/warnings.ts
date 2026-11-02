// Warnings per connection (SPEC §3 "Validation and warnings"). Core returns keys and params;
// the UI renders them through i18n.
import type { MessageKey } from '../i18n';
import type { GaData, GaRule, RouteTemplate } from './data';
import type { Connection, LatLon, Section, WarningType } from './model';
import { calls, transferGaps, isTight } from './planner/connection';
import { stopKey } from './stops';
import { isAfterSunset } from './sun';

export interface Warning {
  type: WarningType;
  severity: 'info' | 'warn' | 'error';
  legIndex: number;
  sectionIndex?: number;
  key: MessageKey;
  params: Record<string, string | number>;
}

export interface WarningContext {
  legIndex: number;
  /** Tour date, `YYYY-MM-DD`. */
  date: string;
  ticket: 'GA' | 'Tageskarte' | 'Halbtax' | 'none';
  templates: RouteTemplate[];
  ga: GaData;
  stop: (ref: string) => LatLon | undefined;
}

const fold = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** "between A and B" in an operator's notice, in the four languages OJP writes them in. */
const BETWEEN = [
  /zwischen (.+?) und (.+?)(?: ist| sind| wird| werden| kommt|[.,;]|$)/i,
  /entre (.+?) et (.+?)(?: est| sont|[.,;]|$)/i,
  /tra (.+?) e (.+?)(?: è| sono|[.,;]|$)/i,
  /between (.+?) and (.+?)(?: is| are|[.,;]|$)/i,
];

/** The two ends a notice names, if it names a stretch. */
export function stretchOf(text: string): [string, string] | undefined {
  for (const re of BETWEEN) {
    const m = re.exec(text);
    if (m) return [m[1]!, m[2]!];
  }
  return undefined;
}

/**
 * Whether a ride's notices concern the stretch you ride: yes when one names no stretch (it may be
 * about anything), or names an end you pass; no only when every one names a stretch whose ends are
 * none of your ride's stops. OJP gives the train, not the stops, so the notice's words decide.
 */
export function onThisStretch(s: Section): boolean {
  const notices = s.notices ?? [];
  if (!notices.length) return true;
  const stops = [s.from, ...s.intermediate, s.to].map((x) => fold(x.name));
  const passes = (end: string) => {
    const e = fold(end);
    return stops.some(
      (x) => x === e || x.startsWith(`${e} `) || e.startsWith(`${x} `) || x.startsWith(`${e},`),
    );
  };
  return notices.some((n) => {
    const ends = stretchOf(n);
    return !ends || passes(ends[0]) || passes(ends[1]);
  });
}

/** A highlight counts as passed at the nearest call within this distance. */
const HIGHLIGHT_KM = 15;

export function isSupplement(s: Section, ga: GaData): boolean {
  if (s.reservationRequired || s.supplement) return true;
  if (s.category && ga.supplementTrains.categories.includes(s.category)) return true;
  const text = `${s.product ?? ''} ${s.line ?? ''}`.toLowerCase();
  return ga.supplementTrains.names.some((n) => text.includes(n.toLowerCase()));
}

export function gaRuleOf(s: Section, ga: GaData): GaRule | null {
  const keys = new Set([s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef)));
  return ga.sections.find((x) => keys.has(x.from) && keys.has(x.to))?.rule ?? null;
}

const km = (a: LatLon, b: LatLon) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371;
};

/** Highlights of the leg's templates passed after sunset − 15 min. */
export function highlightsAfterSunset(c: Connection, ctx: WarningContext) {
  const cs = calls(c).filter((x) => x.at !== undefined);
  const out: { id: string; name: string; at: number }[] = [];
  for (const t of ctx.templates)
    for (const h of t.highlights) {
      if (!h.sunlight) continue;
      let best: { d: number; at: number } | undefined;
      for (const x of cs) {
        const p = ctx.stop(x.key);
        if (!p) continue;
        const d = km(p, h);
        if (d <= HIGHLIGHT_KM && (!best || d < best.d)) best = { d, at: x.at! };
      }
      if (best && isAfterSunset(new Date(best.at), ctx.date, h))
        out.push({ id: h.id, name: h.name, at: best.at });
    }
  return out;
}

const hhmm = (t: number) =>
  new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  }).format(t);

export function warningsFor(c: Connection, ctx: WarningContext): Warning[] {
  const w: Warning[] = [];
  const base = { legIndex: ctx.legIndex };
  c.sections.forEach((s, i) => {
    if (s.mode === 'walk') return;
    const where = { from: s.from.name, to: s.to.name };
    if (s.situationIds?.length)
      w.push(
        onThisStretch(s)
          ? {
              ...base,
              sectionIndex: i,
              type: 'disruption',
              severity: 'error',
              key: 'wDisruption',
              params: where,
            }
          : {
              // The train's own notice, about a stretch of its route you do not ride (its
              // Lausanne–Genève works on your Bern–Zürich): said, not counted against the plan.
              ...base,
              sectionIndex: i,
              type: 'disruption-away',
              severity: 'info',
              key: 'wDisruptionAway',
              params: where,
            },
      );
    if (isSupplement(s, ctx.ga))
      w.push({
        ...base,
        sectionIndex: i,
        type: 'reservation',
        severity: 'warn',
        key: 'wReservation',
        params: where,
      });
    // Shown to everyone, whatever ticket (0.5.1): a fact about the stretch, in neutral blue;
    // those without a GA or day pass can pass over it. (A day pass is valid where the GA is.)
    const rule = gaRuleOf(s, ctx.ga);
    if (rule)
      w.push({
        ...base,
        sectionIndex: i,
        type: 'not-ga',
        severity: 'info',
        key: rule === 'half' ? 'wGaHalf' : rule === 'reduced' ? 'wGaReduced' : 'wGaNone',
        params: where,
      });
  });
  for (const g of transferGaps(c))
    if (isTight(g.min, g.walk))
      w.push({
        ...base,
        sectionIndex: g.afterSection,
        type: 'tight-transfer',
        severity: 'warn',
        key: 'wTightTransfer',
        params: { min: Math.max(0, Math.round(g.min)), at: c.sections[g.afterSection]!.to.name },
      });
  for (const h of highlightsAfterSunset(c, ctx))
    w.push({
      ...base,
      type: 'after-sunset',
      severity: 'warn',
      key: 'wAfterSunset',
      params: { name: h.name, time: hhmm(h.at) },
    });
  const month = Number(ctx.date.slice(5, 7));
  for (const t of ctx.templates)
    if (t.season?.months.includes(month))
      w.push({
        ...base,
        type: 'seasonal',
        severity: 'info',
        key: 'wSeasonal',
        params: { template: t.id },
      });
  return w;
}
