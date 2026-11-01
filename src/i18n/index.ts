import { de } from './de';
import { en, type Catalogue, type MessageKey } from './en';
import { fr } from './fr';
import { it } from './it';

export const LANGS = ['en', 'de', 'fr', 'it'] as const;
export type Lang = (typeof LANGS)[number];

export const CATALOGUES: Record<Lang, Catalogue> = { en, de, fr, it };

/** Picks the first supported language from the browser's list; English otherwise. */
export function pickLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const hit = LANGS.find((l) => l === base);
    if (hit) return hit;
  }
  return 'en';
}

export function translate(
  lang: Lang,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  return CATALOGUES[lang][key].replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

export type { MessageKey };
