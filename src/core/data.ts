// Types for the curated data in src/data/ (checked by tests/data.test.ts).
import type { Lang } from '../i18n';
import type { Mode } from './model';

export interface TemplateStop {
  ref: string;
  name: string;
}

export interface TemplateHighlight {
  id: string;
  name: string;
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
  /** Segment ids from segments.json the leg must not use. */
  avoid: string[];
  modes: Mode[];
  highlights: TemplateHighlight[];
  /** Best seat side in chain order. */
  seat?: 'L' | 'R';
  season?: { months: number[]; note: Record<Lang, string> };
}

/** A stretch identified by its ends: any ride from an `a` stop to a `b` stop (either way)
 * that calls at none of `via` in between takes it (e.g. a base tunnel). */
export interface Segment {
  id: string;
  name: string;
  a: string[];
  b: string[];
  via: string[];
}

export type GaRule = 'half' | 'reduced' | 'none';

export interface GaData {
  /** OSDM delivery the list was built from (scripts/build-ga.ts). */
  version: string;
  source?: string;
  /** Date a person checked the list by hand; null = generated only. */
  reviewed: string | null;
  sections: { from: string; to: string; names: [string, string]; rule: GaRule }[];
  supplementTrains: { categories: string[]; names: string[] };
}
