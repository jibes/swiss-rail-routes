// Prices on SBB (0.27.0): a link to sbb.ch's own timetable for a stretch of the trip, where the
// ticket and its price are, for every operator SBB sells (most of Switzerland's, the scenic
// lines' included). In the form sbb.ch writes its own addresses (0.28.2, from one it made:
// `stops=Zürich+HB_I8503000~Lausanne_I8501120&date="2026-11-08"&time=14_46&moment=dep`).
import type { Connection } from '../model';
import { zurichLocal } from '../planner/plan';
import { stopKey } from '../stops';

const SBB_LANG = { en: 'en', de: 'de', fr: 'fr', it: 'it' } as const;

/** A stop's UIC number from its ref: `ch:1:sloid:7000` → 8507000; a UIC number stays. */
export function uicOf(ref: string): string | undefined {
  const k = stopKey(ref);
  const sloid = /^ch:1:sloid:(\d{1,5})$/.exec(k);
  if (sloid) return String(8_500_000 + Number(sloid[1]));
  return /^\d{7}$/.test(k) ? k : undefined;
}

export function sbbLink(
  stops: { stopRef: string; name: string }[],
  /** When it leaves, ISO. */
  dep: string,
  lang: keyof typeof SBB_LANG = 'en',
): string {
  // As sbb.ch writes it itself: `Zürich HB_I8503000~Lausanne_I8501120`, the name as a form
  // value (spaces as +), the number after `_I`; a stop without a number by its name alone.
  const form = (x: string) => encodeURIComponent(x).replace(/%20/g, '+');
  const stop = (s: { stopRef: string; name: string }) => {
    const uic = uicOf(s.stopRef);
    return uic ? `${form(s.name)}_I${uic}` : form(s.name);
  };
  const local = zurichLocal(Date.parse(dep));
  const q = [
    `stops=${stops.map(stop).join('~')}`,
    `date=${encodeURIComponent(`"${local.slice(0, 10)}"`)}`,
    `time=${local.slice(11, 13)}_${local.slice(14, 16)}`,
    'moment=dep',
    ...(stops.length > 2 ? ['via=1'] : []),
  ];
  return `https://www.sbb.ch/${SBB_LANG[lang]}?${q.join('&')}`;
}

/** One link per leg of the plan: from where it starts to where it ends, at its time. */
export function legLinks(connections: Connection[], lang: keyof typeof SBB_LANG = 'en') {
  return connections.flatMap((c, i) => {
    const rides = c.sections.filter((s) => s.mode !== 'walk');
    const first = rides[0];
    const last = rides.at(-1);
    if (!first?.from.dep || !last) return [];
    return [
      {
        /** Which of the connections. */
        at: i,
        from: first.from.name,
        to: last.to.name,
        dep: first.from.dep,
        url: sbbLink([first.from, last.to], first.from.dep, lang),
      },
    ];
  });
}
