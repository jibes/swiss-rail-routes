// Prices on SBB (0.27.0): a link to sbb.ch's own timetable for a stretch of the trip, where the
// ticket and its price are, for every operator SBB sells (most of Switzerland's, the scenic
// lines' included). The format is SBB's documented deep link (timetable integration, "Deep
// Linking SBB Fahrplan"): stops as a list of {value: UIC number, type: "ID", label}, the date
// and time each in quotes. A station SBB does not know by its number still opens SBB's planner.
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
  from: { stopRef: string; name: string },
  to: { stopRef: string; name: string },
  /** When it leaves, ISO. */
  dep: string,
  lang: keyof typeof SBB_LANG = 'en',
): string {
  const stop = (s: { stopRef: string; name: string }) => {
    const uic = uicOf(s.stopRef);
    return uic
      ? { value: uic, type: 'ID', label: s.name }
      : { value: s.name, type: 'NAME', label: s.name };
  };
  const local = zurichLocal(Date.parse(dep));
  const q = [
    `stops=${encodeURIComponent(JSON.stringify([stop(from), stop(to)]))}`,
    `date=${encodeURIComponent(JSON.stringify(local.slice(0, 10)))}`,
    `time=${encodeURIComponent(JSON.stringify(local.slice(11, 16)))}`,
  ];
  return `https://www.sbb.ch/${SBB_LANG[lang]}?${q.join('&')}`;
}

/** One link per leg of the plan: from where it starts to where it ends, at its time. */
export function legLinks(connections: Connection[], lang: keyof typeof SBB_LANG = 'en') {
  return connections.flatMap((c) => {
    const rides = c.sections.filter((s) => s.mode !== 'walk');
    const first = rides[0];
    const last = rides.at(-1);
    if (!first?.from.dep || !last) return [];
    return [
      {
        from: first.from.name,
        to: last.to.name,
        dep: first.from.dep,
        url: sbbLink(first.from, last.to, first.from.dep, lang),
      },
    ];
  });
}
