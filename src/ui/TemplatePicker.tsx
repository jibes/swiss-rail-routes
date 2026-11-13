import { templateName, type RouteTemplate } from '../core/data';
import type { Lang } from '../i18n';
import { lineReversed } from '../core/lineDirection';
import type { LatLon } from '../core/model';
import { TEMPLATES } from '../data';
import { usePrefs } from '../store';

export { TEMPLATES };

/**
 * Runs a line the way that continues from `from` (the station it is added after) and, when the
 * station after it is one of its ends, the way that leads there (`lineReversed`).
 */
export function directionFrom(
  tp: RouteTemplate,
  from: (LatLon & { ref?: string }) | undefined,
  stop: (ref: string) => (LatLon & { modes?: readonly string[] }) | undefined,
  next?: { ref: string; at?: LatLon },
): boolean {
  return lineReversed(
    tp,
    { before: from ? { ref: from.ref ?? '', at: from } : undefined, after: next },
    stop,
  );
}

/**
 * A scenic line's name by its id (a route that is just that line is called by it), in the app's
 * language (review, 0.65.1: trip names and cards said "Gotthard mountain line" in German too).
 * Screens that call it re-render on a language change already (`useT`).
 */
export const lineName = (id: string, lang: Lang = usePrefs.getState().lang) => {
  const t = TEMPLATES.find((x) => x.id === id);
  return t && templateName(t, lang);
};
