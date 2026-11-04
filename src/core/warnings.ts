// Warnings per connection (SPEC §3 "Validation and warnings"). Core returns keys and params;
// the UI renders them through i18n.
import type { MessageKey } from '../i18n';
import { highlightName, type GaData, type GaRule, type RouteTemplate } from './data';
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
  /** A place by the name a notice gives it (`placeByName`); without it, notices are read by name. */
  place?: (name: string) => LatLon | undefined;
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

/** Where things are, for reading a notice against the track you ride. */
export interface Places {
  stop: (ref: string) => LatLon | undefined;
  /** A place by the name a notice gives it (`placeByName` in stops.ts). */
  place?: (name: string) => LatLon | undefined;
}

/** A place this close to the track you ride counts as on it (an express passing without a stop). */
const ON_TRACK_KM = 2;

/** Kilometres from a point to a segment, and where along it the nearest point is (0…1). */
function toSegment(p: LatLon, a: LatLon, b: LatLon): { km: number; t: number } {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const [ax, ay, bx, by, px, py] = [a.lon * k, a.lat, b.lon * k, b.lat, p.lon * k, p.lat];
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return { km: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111.2, t };
}

/** The track you ride: its geometry, else straight between its calls. */
function trackOf(s: Section, places?: Places): LatLon[] {
  if (s.geometry && s.geometry.length > 1) return s.geometry.map(([lon, lat]) => ({ lat, lon }));
  if (!places) return [];
  return [s.from, ...s.intermediate, s.to].flatMap((c) => {
    const p = places.stop(c.stopRef);
    return p ? [p] : [];
  });
}

/** A place still this near counts at the track's ends (a station a little off its last point). */
const AT_END_KM = 0.3;

/**
 * Whether a place lies by the track: within `ON_TRACK_KM`, and not beyond either end of it
 * (Interlaken Ost, 1.6 km past a ride that starts at Interlaken West, is not on it).
 */
function nearTrack(p: LatLon, track: LatLon[]) {
  let best = { km: Infinity, beyond: false };
  for (let i = 1; i < track.length; i++) {
    const x = toSegment(p, track[i - 1]!, track[i]!);
    if (x.km < best.km)
      best = {
        km: x.km,
        beyond: (i === 1 && x.t === 0) || (i === track.length - 1 && x.t === 1),
      };
  }
  return best.km <= ON_TRACK_KM && !(best.beyond && best.km > AT_END_KM);
}

/**
 * Whether a ride's notices concern the stretch you ride (reported 4 Nov 2026: the VAE St. Gallen–
 * Luzern was flagged for Luzern–Ebikon, the IC1 Lausanne–Zürich for Lausanne–Genève-Aéroport).
 * A notice naming no stretch may be about anything: yes. One naming a stretch "between A and B"
 * counts when you ride it: both ends among your ride's calls, or one of them and the other by the
 * track you ride (an express passing it); neither: only when both are by your track. An end the
 * notice names that cannot be placed counts as by your track. OJP gives the train, not the stops,
 * so the notice's words decide.
 */
export function onThisStretch(s: Section, places?: Places): boolean {
  const notices = s.notices ?? [];
  if (!notices.length) return true;
  const stops = [s.from, ...s.intermediate, s.to].map((x) => fold(x.name));
  const calls = (end: string) => {
    const e = fold(end);
    return stops.some(
      (x) => x === e || x.startsWith(`${e} `) || e.startsWith(`${x} `) || x.startsWith(`${e},`),
    );
  };
  let track: LatLon[] | undefined;
  const byTrack = (end: string) => {
    const p = places?.place?.(end);
    if (!p) return undefined;
    track ??= trackOf(s, places);
    return track.length > 1 ? nearTrack(p, track) : undefined;
  };
  return notices.some((n) => {
    const ends = stretchOf(n);
    if (!ends) return true;
    const [a, b] = ends.map(calls) as [boolean, boolean];
    if (a && b) return true;
    if (a || b) return byTrack(a ? ends[1] : ends[0]) ?? true;
    return (byTrack(ends[0]) ?? false) && (byTrack(ends[1]) ?? false);
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

/** The stretch of a ride the GA or day pass does not cover, named in the order it is ridden. */
export function gaStretchOf(
  s: Section,
  ga: GaData,
): { rule: GaRule; from: string; to: string } | null {
  const calls = [s.from, ...s.intermediate, s.to];
  const at = (k: string) => calls.findIndex((x) => stopKey(x.stopRef) === k);
  for (const x of ga.sections) {
    const i = at(x.from);
    const j = at(x.to);
    if (i < 0 || j < 0) continue;
    const [a, b] = i < j ? [i, j] : [j, i];
    return { rule: x.rule, from: calls[a]!.name, to: calls[b]!.name };
  }
  return null;
}

export function gaRuleOf(s: Section, ga: GaData): GaRule | null {
  return gaStretchOf(s, ga)?.rule ?? null;
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
        out.push({ id: h.id, name: highlightName(h), at: best.at });
    }
  return out;
}

/** A replacement bus's ends this near stations of a line: it stands in for that line. */
const REPLACES_KM = 1.5;

/**
 * The leg's scenic line a replacement bus (category EV) stands in for: both its ends by
 * different stations of the line ("Thusis, Bahnhof" and "Filisur, Bahnhof" on the Albula).
 */
export function lineReplaced(s: Section, ctx: Pick<WarningContext, 'templates' | 'stop'>) {
  if (s.category !== 'EV') return undefined;
  const a = ctx.stop(s.from.stopRef);
  const b = ctx.stop(s.to.stopRef);
  if (!a || !b) return undefined;
  return ctx.templates.find((t) => {
    const at = (p: LatLon) =>
      t.chain.findIndex((c) => {
        const q = ctx.stop(c.ref);
        return !!q && km(p, q) <= REPLACES_KM;
      });
    const i = at(a);
    const j = at(b);
    return i >= 0 && j >= 0 && i !== j;
  });
}

/** A change the line's operator times (`timedChanges`): the arriving and leaving stop by one. */
const TIMED_KM = 0.3;
function timedChange(
  c: Connection,
  after: number,
  ctx: Pick<WarningContext, 'templates' | 'stop'>,
) {
  const p = ctx.stop(c.sections[after]!.to.stopRef);
  if (!p) return false;
  return ctx.templates.some((t) =>
    (t.timedChanges ?? []).some((ref) => {
      const q = ctx.stop(ref);
      return !!q && km(p, q) <= TIMED_KM;
    }),
  );
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
        onThisStretch(s, ctx)
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
    const replaced = lineReplaced(s, ctx);
    if (replaced)
      w.push({
        ...base,
        sectionIndex: i,
        type: 'replacement-bus',
        severity: 'warn',
        key: 'wReplacementBus',
        params: { ...where, line: replaced.name },
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
    // Shown to everyone, whatever ticket (0.5.1): a fact about the stretch, in neutral blue;
    // those without a GA or day pass can pass over it. (A day pass is valid where the GA is.)
    // Named by the stretch itself: a ride Les Marécottes → Vallorcine is covered up to the border.
    const ga = gaStretchOf(s, ctx.ga);
    if (ga)
      w.push({
        ...base,
        sectionIndex: i,
        type: 'not-ga',
        severity: 'info',
        key: ga.rule === 'half' ? 'wGaHalf' : ga.rule === 'reduced' ? 'wGaReduced' : 'wGaNone',
        params: { from: ga.from, to: ga.to },
      });
  });
  for (const g of transferGaps(c))
    if (isTight(g.min, g.walk)) {
      const params = {
        min: Math.max(0, Math.round(g.min)),
        at: c.sections[g.afterSection]!.to.name,
      };
      w.push(
        timedChange(c, g.afterSection, ctx)
          ? {
              ...base,
              sectionIndex: g.afterSection,
              type: 'timed-change',
              severity: 'info',
              key: 'wTimedChange',
              params,
            }
          : {
              ...base,
              sectionIndex: g.afterSection,
              type: 'tight-transfer',
              severity: 'warn',
              key: 'wTightTransfer',
              params,
            },
      );
    }
  for (const h of highlightsAfterSunset(c, ctx))
    w.push({
      ...base,
      type: 'after-sunset',
      severity: 'warn',
      key: 'wAfterSunset',
      params: { name: h.name, highlight: h.id, time: hhmm(h.at) },
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
