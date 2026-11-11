import { toIcs } from '../core/export/ics';
import type { Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (tour: Tour, ext: string) =>
  `${(tour.name || 'tour').replace(/[^\p{L}\p{N}]+/gu, '-')}-${tour.date}.${ext}`;

/** The trip in the calendar: one event per train (ICS, made on the device). */
export function downloadIcs(tour: Tour, name: string, chain: PlannedChain, uid: string) {
  download(fileName(tour, 'ics'), 'text/calendar', toIcs(name, chain.connections, uid, new Date()));
}
