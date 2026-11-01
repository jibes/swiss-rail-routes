// Warnings per connection (SPEC §3 "Validation and warnings"). Core returns keys and params;
// the UI renders them through i18n.
import type { MessageKey } from '../i18n';
import type { GaData, GaRule, RouteTemplate } from './data';
import type { Connection, LatLon, Section, WarningType } from './model';
import { calls, transferGaps } from './planner/connection';
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

export const TIGHT_TRANSFER_MIN = 4;
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
      w.push({
        ...base,
        sectionIndex: i,
        type: 'disruption',
        severity: 'error',
        key: 'wDisruption',
        params: where,
      });
    if (isSupplement(s, ctx.ga))
      w.push({
        ...base,
        sectionIndex: i,
        type: 'reservation',
        severity: 'warn',
        key: 'wReservation',
        params: where,
      });
    if (ctx.ticket === 'GA') {
      const rule = gaRuleOf(s, ctx.ga);
      if (rule)
        w.push({
          ...base,
          sectionIndex: i,
          type: 'not-ga',
          severity: 'warn',
          key: rule === 'half' ? 'wGaHalf' : rule === 'reduced' ? 'wGaReduced' : 'wGaNone',
          params: where,
        });
    }
  });
  for (const g of transferGaps(c))
    if (g.min < TIGHT_TRANSFER_MIN)
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
