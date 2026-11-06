// Warnings per connection (SPEC §3 "Validation and warnings"). Core returns keys and params;
// the UI renders them through i18n.
import type { MessageKey } from '../i18n';
import { highlightName, type GaData, type GaRule, type RouteTemplate } from './data';
import type { Connection, LatLon, Section, WarningType } from './model';
import { calls, transferGaps, isTight } from './planner/connection';
import { stopKey } from './stops';
import { isAfterSunset, sunset } from './sun';

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
  /zwischen (.+?) und (.+?)(?: ist| sind| wird| werden| kommt|[.,;:]|$)/i,
  /entre (.+?) et (.+?)(?: est| sont|[.,;:]|$)/i,
  /tra (.+?) e (.+?)(?: è| sono|[.,;:]|$)/i,
  /between (.+?) and (.+?)(?: is| are|[.,;:]|$)/i,
];

/** A place's name in a notice: capitalised, up to the punctuation or verb after it. */
const NAME = String.raw`(\p{Lu}[\p{L}\p{M}'’ ./-]*?)`;
const END = String.raw`(?=\s*(?:[.,;:()!]|$)|\s+(?:ist|sind|wird|werden|est|sont|è|sono|is|are|und|et|e|and|ab|bis)\b)`;
const re = (lead: string) => new RegExp(String.raw`(?:^|\s)(?:${lead}) ${NAME}${END}`, 'u');
/** "from A to B" (capitalised places only: "de 10 minutes à cause…" is none). */
const FROM_TO = [
  new RegExp(String.raw`(?:^|\s)von ${NAME} bis ${NAME}${END}`, 'u'),
  new RegExp(String.raw`(?:^|\s)de ${NAME} à ${NAME}${END}`, 'u'),
  new RegExp(String.raw`(?:^|\s)da ${NAME} a ${NAME}${END}`, 'u'),
  new RegExp(String.raw`(?:^|\s)from ${NAME} to ${NAME}${END}`, 'u'),
];
/** "from X" onwards ("ab Erstfeld"), and "up to X". */
const FROM = [re('ab'), re('dès|à partir de'), re('da|a partire da'), re('from')];
const UNTIL = [re('bis'), re("jusqu’à|jusqu'à|jusqu’au|jusqu'au"), re('fino a'), re('up to|until')];

/** The two ends a notice names, if it names a stretch between two places. */
export function stretchOf(text: string): [string, string] | undefined {
  const s = noticeStretch(text);
  return s?.from && s.to ? [s.from, s.to] : undefined;
}

/**
 * The stretch a notice names: between two places, or from one onwards ("ab Erstfeld", in the
 * direction of travel), or up to one. Undefined when it names none.
 */
export function noticeStretch(text: string): { from?: string; to?: string } | undefined {
  for (const r of [...BETWEEN, ...FROM_TO]) {
    const m = r.exec(text);
    if (m) return { from: m[1]!.trim(), to: m[2]!.trim() };
  }
  for (const r of FROM) {
    const m = r.exec(text);
    if (m) return { from: m[1]!.trim() };
  }
  for (const r of UNTIL) {
    const m = r.exec(text);
    if (m) return { to: m[1]!.trim() };
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
  // By the stop, not its platform: a ref as it comes carries its quay (`…:9198:0:2`), which
  // the index does not know; without them the track was empty and every notice "on" (the MCP,
  // which drops tracks, said Thusis–Preda on the IR38 from Preda; retest, 5 Nov 2026).
  return [s.from, ...s.intermediate, s.to].flatMap((c) => {
    const p = places.stop(c.stopRef) ?? places.stop(stopKey(c.stopRef));
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
  return stretchHere(s, places) !== null;
}

/**
 * The stretch of the first notice that concerns the ride (`onThisStretch`): what it names, or
 * `{}` for a notice naming none; null when no notice concerns the stretch you ride. "From X" is
 * from X onwards in the direction of travel: a ride that ends at X, or before it, is elsewhere;
 * "up to X" is elsewhere for a ride that starts at X, or beyond it.
 */
export function stretchHere(
  s: Section,
  places?: Places,
): { from?: string; to?: string; n?: number } | null {
  const notices = s.notices ?? [];
  if (!notices.length) return {};
  const stops = [s.from, ...s.intermediate, s.to].map((x) => fold(x.name));
  const callAt = (end: string) => {
    const e = fold(end);
    return stops.findIndex(
      (x) => x === e || x.startsWith(`${e} `) || e.startsWith(`${x} `) || x.startsWith(`${e},`),
    );
  };
  const calls = (end: string) => callAt(end) >= 0;
  let track: LatLon[] | undefined;
  const trackHere = () => (track ??= trackOf(s, places));
  const byTrack = (end: string) => {
    const p = places?.place?.(end);
    if (!p) return undefined;
    const t = trackHere();
    return t.length > 1 ? nearTrack(p, t) : undefined;
  };
  /** Off the track: whether the place lies past its end (else before its start). */
  const pastEnd = (end: string) => {
    const p = places?.place?.(end);
    const t = trackHere();
    if (!p || t.length < 2) return undefined;
    return km(p, t.at(-1)!) < km(p, t[0]!);
  };
  const all = [s.from, ...s.intermediate, s.to];
  const at = (i: number) => {
    const c = all[i]!;
    return places?.stop(c.stopRef) ?? places?.stop(stopKey(c.stopRef));
  };
  /**
   * One end of the stretch is a call (`end`), the other (`other`) is not. Passing the other on
   * its track: on. Touching `end` only at its first or last call (retest round 3, 6 Nov 2026):
   * on when the ride lies inside the stretch, its far end between the two (the Mont-Blanc Express
   * Les Marécottes–Vallorcine for "Martigny–Vallorcine"), else away (the S1 Sursee–Luzern for
   * "Luzern–Ebikon" comes from the other side); away too when where things are is not known.
   * Through `end` mid-ride: on unless its track shows it misses the other.
   */
  const oneEnd = (end: string, other: string): boolean => {
    const near = byTrack(other);
    if (near) return true;
    const i = callAt(end);
    if (i !== 0 && i !== stops.length - 1) return near ?? true;
    const e = at(i);
    const far = at(i === 0 ? stops.length - 1 : 0);
    const o = places?.place?.(other);
    if (!e || !far || !o) return false;
    const span = km(e, o);
    return km(far, e) < span && km(far, o) < span;
  };
  for (const [k, n] of notices.entries()) {
    const found = noticeStretch(n);
    if (!found) return { n: k };
    const st = { ...found, n: k };
    if (st.from && st.to) {
      const [a, b] = [st.from, st.to].map(calls) as [boolean, boolean];
      const on =
        a && b
          ? true
          : a || b
            ? oneEnd(a ? st.from : st.to, a ? st.to : st.from)
            : (byTrack(st.from) ?? false) && (byTrack(st.to) ?? false);
      if (on) return st;
      continue;
    }
    const x = (st.from ?? st.to)!;
    const i = callAt(x);
    let on: boolean;
    if (i >= 0) on = st.from ? i < stops.length - 1 : i > 0;
    else if (byTrack(x)) on = true;
    else {
      // From X: on when the ride lies beyond X (X before its start); up to X: when before it.
      const past = pastEnd(x);
      on = past === undefined ? true : st.from ? !past : past;
    }
    if (on) return st;
  }
  return null;
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

/**
 * A ride whose GA cover nothing shows: a cable car or cog railway (where the private summit
 * lines are) with no fare rule and no GA fare of 0 on a stretch it rides (`ga.covered`, the
 * evidence from SBB's fare data: Rigi, Grütschalp…). Trains, buses and boats count as covered.
 */
export function gaUnknown(s: Section, ga: GaData): boolean {
  if (s.mode !== 'cableCar' && s.mode !== 'cog') return false;
  const keys = new Set([s.from, ...s.intermediate, s.to].map((x) => stopKey(x.stopRef)));
  const has = (refs: string[]) => refs.some((r) => keys.has(r));
  return !(ga.covered ?? []).some((c) => has(c.from) && has(c.to));
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

/** Dusk this long after sunset counts as dark: little left to see from the train. */
export const DUSK_MIN = 15;

/**
 * The scenic lines a connection rides into the dark (reported on the MCP, 5 Nov 2026: a 16:05
 * Gotthard option rode the mountain line after sunset, said only for one of its highlights):
 * the line's own stations the connection calls at, two or more, the last of them after sunset
 * plus `DUSK_MIN` at the middle one. From when it is dark, or from the first of them when all is.
 */
export function linesAfterDark(
  c: Connection,
  ctx: Pick<WarningContext, 'templates' | 'stop' | 'date'>,
) {
  const cs = calls(c).filter((x) => x.at !== undefined);
  const out: { template: RouteTemplate; from: number; sectionIndex: number }[] = [];
  for (const t of ctx.templates) {
    const own = new Set(t.chain.map((x) => stopKey(x.ref)));
    const on = cs.filter((x) => own.has(x.key));
    if (on.length < 2) continue;
    const mid = ctx.stop(on[Math.floor((on.length - 1) / 2)]!.key);
    const set = mid && sunset(ctx.date, mid);
    if (!set) continue;
    const dark = set.getTime() + DUSK_MIN * 60_000;
    const last = on.at(-1)!;
    if (last.at! <= dark) continue;
    const first = on.find((x) => x.at! > dark) ?? last;
    out.push({ template: t, from: Math.max(on[0]!.at!, dark), sectionIndex: first.sectionIndex });
  }
  return out;
}

/** A replacement bus's ends this near stations of a line: it stands in for that line. */
const REPLACES_KM = 1.5;

/**
 * The leg's scenic line a replacement bus (category EV) stands in for, and the line's stations
 * from where it leaves to where it arrives, in the order ridden: both its ends by different
 * stations of the line ("Thusis, Bahnhof" and "Filisur, Bahnhof" on the Albula, or the express bus
 * Thusis–Preda that calls nowhere between).
 */
export function lineStretch(s: Section, ctx: Pick<WarningContext, 'templates' | 'stop'>) {
  if (!isReplacementBus(s)) return undefined;
  // By the stop, not its quay ("ch:1:sloid:80179:0:667", Thusis, Bahnhof's bus stand).
  const a = ctx.stop(stopKey(s.from.stopRef));
  const b = ctx.stop(stopKey(s.to.stopRef));
  if (!a || !b) return undefined;
  for (const t of ctx.templates) {
    const course = t.chain.map((c) => ctx.stop(c.ref));
    if (course.some((q) => !q)) continue;
    const pts = course as LatLon[];
    // Where along the line's course (through its stations) a point lies, as station index plus
    // the share of the next stretch: by any of its stations, or beside the course between two
    // (round 3, 6 Nov 2026: the Mont-Blanc Express's bus Martigny–Les Marécottes, whose end is
    // no station the line must pass).
    const along = (p: LatLon): number | undefined => {
      let best: { km: number; at: number } | undefined;
      for (let k = 0; k + 1 < pts.length; k++) {
        const d = toSegment(p, pts[k]!, pts[k + 1]!);
        if (d.km <= REPLACES_KM && (!best || d.km < best.km)) best = { km: d.km, at: k + d.t };
      }
      return best?.at;
    };
    const i = along(a);
    const j = along(b);
    if (i === undefined || j === undefined || Math.abs(i - j) < 0.05) continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    // The line's stations the bus passes by road: those between its ends, and an end's own.
    const near = (k: number) => Math.abs(k - lo) < 0.05 || Math.abs(k - hi) < 0.05;
    const run = t.chain
      .map((c, k) => ({ key: stopKey(c.ref), k }))
      .filter(({ k }) => (k > lo && k < hi) || near(k))
      .map(({ key }) => key);
    if (!run.length) continue;
    return { template: t, stations: i < j ? run : run.reverse() };
  }
  return undefined;
}

/** The leg's scenic line a replacement bus stands in for (`lineStretch`). */
export const lineReplaced = (s: Section, ctx: Pick<WarningContext, 'templates' | 'stop'>) =>
  lineStretch(s, ctx)?.template;

/**
 * Marks each replacement bus that stands in for one of the leg's lines with the line's stations
 * it passes by road (`Section.byRoad`), so they count as passed (reported 5 Nov 2026: the
 * Albula's express bus Thusis–Preda counted as missing Filisur and Bergün, and the Albula asked
 * for was planned via the Vereina instead). Copies only what changes.
 */
export function markByRoad(
  list: Connection[],
  ctx: Pick<WarningContext, 'templates' | 'stop'>,
): Connection[] {
  if (!ctx.templates.length) return list;
  return list.map((c) => {
    let changed = false;
    const sections = c.sections.map((s) => {
      const run = lineStretch(s, ctx);
      if (!run) return s;
      changed = true;
      return { ...s, byRoad: run.stations };
    });
    return changed ? { ...c, sections } : c;
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

/**
 * A notice's weight on this ride: as its words say (`gradeNotice`, 0.21.2), a closure ridden by its
 * own replacement bus only a warning (the way round is the plan), and an error for plans saved
 * before notices were graded.
 */
/** Warnings that carry the operator's own message, opened on a tap. */
export const NOTICE_TYPES: ReadonlySet<Warning['type']> = new Set([
  'disruption',
  'disruption-away',
  'notice',
  'reservation-advised',
]);

/** Words of a reservation advice, in the four languages ("Reservierung … empfohlen"). */
const RESERVE = /reserv|prenota/i;

/** Whether the notice (or, not known which, any of the ride's) advises a reservation. */
function isReservationAdvice(s: Section, n: number | undefined): boolean {
  const texts = n === undefined ? (s.notices ?? []) : [s.notices?.[n] ?? ''];
  return texts.some((t) => RESERVE.test(t));
}

/**
 * A replacement bus: category `EV`, or a bus whose line is named so (`EV2`, category `B`: the
 * Mont-Blanc Express's Martigny–Les Marécottes, round 3, 6 Nov 2026).
 */
export const isReplacementBus = (s: Pick<Section, 'category' | 'line' | 'mode'>) =>
  s.category === 'EV' || (s.mode === 'bus' && /^EV\s?\d/.test(s.line ?? ''));

function gradeHere(s: Section, n: number | undefined): Warning['severity'] {
  const g = (n === undefined ? undefined : s.noticeInfo?.[n]?.grade) ?? 'error';
  return g === 'error' && isReplacementBus(s) ? 'warn' : g;
}

export function warningsFor(c: Connection, ctx: WarningContext): Warning[] {
  const w: Warning[] = [];
  const base = { legIndex: ctx.legIndex };
  c.sections.forEach((s, i) => {
    if (s.mode === 'walk') return;
    const where = { from: s.from.name, to: s.to.name };
    const here = s.situationIds?.length ? stretchHere(s, ctx) : undefined;
    if (here !== undefined) {
      const severity = here ? gradeHere(s, here.n) : 'info';
      // A notice its words grade as information is no disruption (round 3, 6 Nov 2026: the
      // Centovalli's reservation advice was said "Disruption Locarno FART–Domodossola").
      const advice = here && severity === 'info' && isReservationAdvice(s, here.n);
      const info = severity === 'info';
      w.push(
        advice
          ? {
              ...base,
              sectionIndex: i,
              type: 'reservation-advised',
              severity: 'info',
              key: 'wReservationAdvised',
              params: where,
            }
          : here
            ? {
                // Named by the stretch the notice gives, else by the ride (reported 5 Nov 2026:
                // "ab Erstfeld" was said as the whole Zürich HB–Bellinzona).
                ...base,
                sectionIndex: i,
                type: info ? 'notice' : 'disruption',
                severity,
                ...(here.from && here.to
                  ? {
                      key: info ? 'wNotice' : 'wDisruption',
                      params: { from: here.from, to: here.to },
                    }
                  : here.from
                    ? { key: info ? 'wNoticeFrom' : 'wDisruptionFrom', params: { at: here.from } }
                    : here.to
                      ? { key: info ? 'wNoticeUntil' : 'wDisruptionUntil', params: { at: here.to } }
                      : { key: info ? 'wNotice' : 'wDisruption', params: where }),
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
    }
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
    // For a GA or a day pass (valid where the GA is), the app's ticket since 0.5.1: a fact about
    // the stretch, in neutral blue. Without one (Halbtax, none: only the MCP asks so) there is no
    // cover to speak of (round 3, 6 Nov 2026: `ticket: none` was told "not covered by GA").
    // Named by the stretch itself: a ride Les Marécottes → Vallorcine is covered up to the border.
    const pass = ctx.ticket === 'GA' || ctx.ticket === 'Tageskarte';
    const ga = pass ? gaStretchOf(s, ctx.ga) : undefined;
    if (ga)
      w.push({
        ...base,
        sectionIndex: i,
        type: 'not-ga',
        severity: 'info',
        key: ga.rule === 'half' ? 'wGaHalf' : ga.rule === 'reduced' ? 'wGaReduced' : 'wGaNone',
        params: { from: ga.from, to: ga.to },
      });
    // Unknown is never covered (retest round 3: the Eiger Express and the Jungfraubahn from
    // Eigergletscher said nothing): the fare data names the summit lines SBB sells, so a cable
    // car or cog railway it does not name may well not be the GA's. Said, not counted.
    else if (pass && gaUnknown(s, ctx.ga))
      w.push({
        ...base,
        sectionIndex: i,
        type: 'ga-unknown',
        severity: 'info',
        key: 'wGaUnknown',
        params: { from: s.from.name, to: s.to.name },
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
  for (const d of linesAfterDark(c, ctx))
    w.push({
      ...base,
      sectionIndex: d.sectionIndex,
      type: 'line-after-dark',
      severity: 'warn',
      key: 'wLineAfterDark',
      params: { line: d.template.name, time: hhmm(d.from) },
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
