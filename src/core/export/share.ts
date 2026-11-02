// Share link: the tour as base64url JSON in the URL hash (`#/t/<data>`). No server involved.
import type { Tour } from '../model';
import { fromB64Url, toB64Url } from '../b64';
import { sanitiseTour } from '../tour';
import { dayOf } from '../trip';

const PREFIX = '#/t/';

/** Drops the id: a shared tour becomes a new tour on the receiving device. */
export function encodeTour(tour: Tour): string {
  const { id: _id, ...rest } = tour;
  return PREFIX + toB64Url(new TextEncoder().encode(JSON.stringify(rest)));
}

export function decodeTour(hash: string, id: string, fallbackDate = ''): Tour | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64Url(hash.slice(PREFIX.length))));
    if (data?.schema !== 1) return null;
    // Rebuilt from checked fields: a crafted link must not put anything else into the store.
    const tour = sanitiseTour(data, fallbackDate || dayOf(Date.now()));
    return tour && { ...tour, id };
  } catch {
    return null;
  }
}
