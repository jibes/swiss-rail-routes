// What a station of the line says beside its name: a stay (and the time really spent there), a
// long wait at a change (0.53.0).
import { zurichLocal } from '../core/planner/plan';
import type { StationRow } from '../core/rows';
import type { useT } from '../store';
import { duration, shortDate } from './format';

/** A wait at a change this long is said (review of 11 Nov 2026: hours hid in a dotted gap). */
const WAIT_SAID_MIN = 10;

/**
 * A stay is said, with the time really spent there when the next train leaves well after it;
 * a change only when its wait is long (else it is a big dot with two times).
 */
export function stayLabel(
  t: ReturnType<typeof useT>,
  r: StationRow,
  leaveBy?: string,
  until?: { at: string; lang: string; day?: string },
) {
  const there =
    r.arr && r.dep ? Math.round((Date.parse(r.dep) - Date.parse(r.arr)) / 60_000) : undefined;
  if (r.role === 'change')
    return there !== undefined && there >= WAIT_SAID_MIN
      ? t('waitFor', { d: duration(there) })
      : '';
  if (r.role !== 'stop' || !r.stay) return '';
  // Until a time: said as such, the length beside it moot; its day only when not the
  // arrival's (else the trip's).
  if (until) {
    const day = (r.arr && zurichLocal(Date.parse(r.arr)).slice(0, 10)) || until.day;
    const date = until.at.slice(0, 10);
    const time = until.at.slice(11, 16);
    return t('stayTill', {
      when: date === day ? time : `${shortDate(date, until.lang)} ${time}`,
    });
  }
  const label = leaveBy
    ? t('stayUntil', { min: r.stay, time: leaveBy })
    : t('stayFor', { min: r.stay });
  return there !== undefined && there >= r.stay + WAIT_SAID_MIN
    ? t('stayThere', { label, d: duration(there) })
    : label;
}
