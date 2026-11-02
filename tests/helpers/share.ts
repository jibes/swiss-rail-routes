// Old share links (`#/t/<data>`): the app still opens them; the tests write them.
import { toB64Url } from '../../src/core/b64';
import type { Tour } from '../../src/core/model';

/** Drops the id: a shared tour becomes a new tour on the receiving device. */
export function encodeTour(tour: Tour): string {
  const { id: _id, ...rest } = tour;
  return '#/t/' + toB64Url(new TextEncoder().encode(JSON.stringify(rest)));
}
