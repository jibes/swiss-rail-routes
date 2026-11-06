// Types for the curated data in src/data/ (checked by tests/data.test.ts).
import type { Lang } from '../i18n';
import type { Mode } from './model';

export interface TemplateStop {
  ref: string;
  name: string;
}

export interface TemplateHighlight {
  id: string;
  /** In each language (0.18.1); a plain string, as before, reads as its name in all. */
  name: string | Record<Lang, string>;
  lat: number;
  lon: number;
  /** Side to sit on, travelling in chain order. */
  side?: 'L' | 'R';
  sunlight: boolean;
}

export interface RouteTemplate {
  id: string;
  name: string;
  /** Stops in travel order; usable reversed. */
  chain: TemplateStop[];
  /** Served stops a connection must call at (checked against intermediate stops). */
  mustPass: string[];
  modes: Mode[];
  highlights: TemplateHighlight[];
  /** Best seat side in chain order (sources: src/data/SEATS.md). */
  seat?: 'L' | 'R';
  /** The chain station the seat side holds from, when only part of the line has the view. */
  seatFrom?: string;
  season?: { months: number[]; note: Record<Lang, string> };
  /**
   * Chain stations where the operator times one vehicle for the other (Grütschalp: the train
   * waits for the cable car): a tight change there is said as timed, not as a risk.
   */
  timedChanges?: string[];
}

export type GaRule = 'half' | 'reduced' | 'none';

export interface GaData {
  /** OSDM delivery the list was built from (scripts/build-ga.ts). */
  version: string;
  source?: string;
  /** Date a person checked the list by hand; null = generated only. */
  reviewed: string | null;
  sections: { from: string; to: string; names: [string, string]; rule: GaRule }[];
  /**
   * Summit stretches (a cable car, cog or funicular stop at one end) with a GA fare of 0: the
   * evidence that the GA covers them. Each end lists the stops within 1 km, where the line may
   * leave from. A cable car or cog ride with neither a rule nor this is said as not known.
   */
  covered?: { from: string[]; to: string[]; names: [string, string] }[];
  supplementTrains: { categories: string[]; names: string[] };
}

/** A highlight's name in a language: its own, else English, else the plain name it had. */
export const highlightName = (h: Pick<TemplateHighlight, 'name'>, lang: Lang = 'en') =>
  typeof h.name === 'string' ? h.name : (h.name[lang] ?? h.name.en);

/**
 * A warning's or notice's words with a highlight's name in the reader's language: core says it
 * by its id (`highlight`) and in English (`name`), the reader's screen in theirs.
 */
export function localParams<P extends Record<string, string | number>>(
  params: P,
  lang: Lang,
  templates: Pick<RouteTemplate, 'highlights'>[],
): P {
  const id = params.highlight;
  if (typeof id !== 'string') return params;
  const h = templates.flatMap((t) => t.highlights).find((x) => x.id === id);
  return h ? { ...params, name: highlightName(h, lang) } : params;
}
