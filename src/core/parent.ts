/**
 * The screen Back goes to from a hash route (Android's back button): the next level up, never
 * the browser's history, which the in-app Back buttons lengthen. `undefined` on the main list.
 */
export function parentOf(full: string): string | undefined {
  const hash = full.split('?')[0] || '/';
  if (hash === '/' || hash === '/trips') return undefined;
  // A trip's map and replan (older addresses: now, edit) go up to the trip.
  const sub = /^\/trip\/([\w-]+)\/(map|edit|now|replan)$/.exec(hash);
  if (sub) return `/trip/${sub[1]}`;
  return '/';
}
