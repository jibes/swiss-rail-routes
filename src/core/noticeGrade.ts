// How much an operator's notice weighs (retest, 5 Nov 2026: a 1-min timetable shift "ab Erstfeld"
// was an error, as the Albula's closure). OJP's own fields say nothing here: every situation
// recorded (63, Nov 2026) has Severity normal, Priority 3, Planned true, and all but one
// AlertCause constructionWork. So the operator's words decide, in the four languages they write.
// Pure.

export type NoticeGrade = 'info' | 'warn' | 'error';

/** Closed or cancelled: the train does not run there. */
const ERROR = [
  /unterbrochen|gesperrt|eingestellt|fällt aus|fallen aus|entfällt|entfallen|ausfall/i,
  /interrompu|suspendu|supprimée?s?|annulée?s?|fermée?/i,
  /interrott[oa]|sospes[oa]|soppress[oi]|cancellat[oi]|chius[oa]/i,
  /interrupted|suspended|cancell?ed|closed/i,
];

/** It runs, but not as planned: replaced, rerouted, restricted, late, a stop left out. */
const WARN = [
  /eingeschränkt|unregelm(ä|ae)ssig|versp(ä|ae)tung|ersatz|umgeleitet|nicht bedient|hält nicht/i,
  /restreint|perturbée?|irrégulier|retard|remplacement|déviée?|pas desservi|ne s'arrête pas/i,
  /limitat[oa]|perturbat[oa]|irregolare|ritard[oi]|sostitutiv[oa]|deviat[oa]|non servit[oa]|non ferma/i,
  /restricted|irregular|delays?|replacement|diverted|not served|does not stop/i,
];

/** The weight of a notice by its words (headline and consequences): the most a text says. */
export function gradeNotice(...texts: (string | undefined)[]): NoticeGrade {
  const t = texts.filter(Boolean).join(' ');
  if (ERROR.some((r) => r.test(t))) return 'error';
  if (WARN.some((r) => r.test(t))) return 'warn';
  return 'info';
}

const RANK: Record<NoticeGrade, number> = { info: 0, warn: 1, error: 2 };

/** The heavier of two grades. */
export const heavier = (a: NoticeGrade, b: NoticeGrade): NoticeGrade =>
  RANK[a] >= RANK[b] ? a : b;
