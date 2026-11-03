// A tab left open never navigates (hash routes), so the browser asks the service worker for a
// new version only on its own schedule, which can be days for an installed app resumed from
// memory. Ask ourselves: when the app comes back into view, and every hour.
export const UPDATE_EVERY_MS = 60 * 60_000;

type Doc = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;

/** Calls `update` on every return to view and every `every` ms; returns the stop. */
export function watchUpdates(
  update: () => Promise<unknown>,
  doc: Doc = document,
  every = UPDATE_EVERY_MS,
): () => void {
  const check = () => void update().catch(() => undefined);
  const onVisible = () => {
    if (doc.visibilityState === 'visible') check();
  };
  doc.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, every);
  return () => {
    doc.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
