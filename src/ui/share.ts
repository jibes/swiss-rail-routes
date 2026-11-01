import { publicUrl } from '../native';

/** The system share sheet where there is one, else the clipboard. */
export async function shareLink(hash: string, title: string): Promise<'shared' | 'copied'> {
  const url = `${publicUrl()}${hash}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch {
      // Cancelled or refused: copy instead.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
