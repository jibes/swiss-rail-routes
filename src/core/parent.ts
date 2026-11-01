/**
 * The screen Back goes to from a hash route (Android's back button): the next level up, never
 * the browser's history, which the in-app Back buttons lengthen. `undefined` on the main list.
 */
export function parentOf(full: string): string | undefined {
  const hash = full.split('?')[0] || '/';
  if (hash === '/' || hash === '/trips') return undefined;
  const sub = /^\/(tour|trip)\/([\w-]+)\/(plan|templates|map|edit|now|replan)$/.exec(hash);
  if (sub) return `/${sub[1]}/${sub[2]}`;
  return '/';
}
