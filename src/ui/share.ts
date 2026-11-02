import { publicUrl } from '../native';

/** The system share sheet where there is one, else the clipboard. */
export async function shareLink(
  hash: string,
  title: string,
): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = `${publicUrl()}${hash}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (e) {
      // Closed by the user: nothing happens. Refused (no permission, unsupported): copy.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
