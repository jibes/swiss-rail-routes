// "Open in SBB" for one leg: sbb.ch's timetable URL with from, to, vias, date and time.
// The SBB app takes sbb.ch links. Format unverified against sbb.ch; check monthly (SPEC §9).
import type { Leg } from '../model';

export function sbbUrl(leg: Leg, date: string, time: string): string {
  const [y, m, d] = date.split('-');
  const p = new URLSearchParams({
    von: leg.from.name,
    nach: leg.to.name,
    datum: `${d}.${m}.${y}`,
    zeit: time,
    an: 'false',
  });
  leg.vias.slice(0, 3).forEach((v, i) => p.set(`via${i + 1}`, v.name));
  return `https://www.sbb.ch/de/kaufen/pages/fahrplan/fahrplan.xhtml?${p}`;
}
