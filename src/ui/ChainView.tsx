import type { Connection, Section } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import type { Warning } from '../core/warnings';
import { usePrefs, useT } from '../store';
import { duration, hhmm, minutesBetween } from './format';
import { TEMPLATES } from './TemplatePicker';

/** "R62", "IC3"; numeric lines with their category: "CC 63" (cog), "PB 2461" (cable car). */
const badge = (s: Section) =>
  s.line && /[A-Za-z]/.test(s.line)
    ? s.line
    : [s.category, s.line ?? s.number].filter(Boolean).join(' ');

const SEVERITY: Record<Warning['severity'], string> = {
  error: 'warn-red',
  warn: 'warn-amber',
  info: '',
};

function Warnings({ list }: { list: Warning[] }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  if (!list.length) return null;
  return (
    <ul className="warns">
      {list.map((w, i) => (
        <li key={i} className={`warn ${SEVERITY[w.severity]}`}>
          {w.type === 'seasonal'
            ? (TEMPLATES.find((x) => x.id === w.params.template)?.season?.note[lang] ??
              t(w.key, w.params))
            : t(w.key, w.params)}
        </li>
      ))}
    </ul>
  );
}

/** A connection as rows on the rail: stations (arrival over departure at a change) and rides. */
type Row =
  | { kind: 'station'; name: string; arr?: string; dep?: string; platform?: string }
  | { kind: 'ride'; s: Section; index: number }
  | { kind: 'walk'; min: number; to?: string };

function rowsOf(c: Connection): Row[] {
  const rows: Row[] = [];
  c.sections.forEach((s, index) => {
    if (s.mode === 'walk') {
      return;
    }
    const last = rows.at(-1);
    if (last?.kind === 'station' && last.name === s.from.name) {
      last.dep = s.from.dep;
      last.platform = s.from.platform ?? last.platform;
    } else {
      if (last?.kind === 'station' && last.arr && s.from.dep) {
        rows.push({ kind: 'walk', min: minutesBetween(last.arr, s.from.dep), to: s.from.name });
      }
      rows.push({ kind: 'station', name: s.from.name, dep: s.from.dep, platform: s.from.platform });
    }
    rows.push({ kind: 'ride', s, index });
    rows.push({ kind: 'station', name: s.to.name, arr: s.to.arr, platform: s.to.platform });
  });
  return rows;
}

function Leg({ c, warnings }: { c: Connection; warnings: Warning[] }) {
  const t = useT();
  const rows = rowsOf(c);
  return (
    <ol>
      {rows.map((r, i) => {
        const pos = `${i === 0 ? 'first' : ''} ${i === rows.length - 1 ? 'last' : ''}`;
        if (r.kind === 'station')
          return (
            <li
              key={i}
              className={`row station ${pos} ${i === 0 || i === rows.length - 1 ? 'end' : ''}`}
            >
              <span className="times-col">
                {r.arr && <time>{hhmm(r.arr)}</time>}
                {r.dep && <time>{hhmm(r.dep)}</time>}
              </span>
              <span className="rail" />
              <span className="what">
                <b>{r.name}</b>
                {r.platform && <span className="plat">{t('platform', { p: r.platform })}</span>}
              </span>
            </li>
          );
        if (r.kind === 'walk')
          return (
            <li key={i} className={`row walk ${pos}`}>
              <span />
              <span className="rail" />
              <span className="what">
                {t('walk')} {r.min > 0 && `${r.min}′`}
              </span>
            </li>
          );
        const own = warnings.filter((w) => w.sectionIndex === r.index);
        return (
          <li key={i} className={`row ride ${pos}`}>
            <span />
            <span className="rail" />
            <span className="what">
              <span className="line-info">
                <span className="badge">{badge(r.s)}</span>
                {r.s.intermediate.length === 1
                  ? t('stop1')
                  : r.s.intermediate.length > 1 &&
                    t('stopsBetween', { n: r.s.intermediate.length })}
                {r.s.from.dep && r.s.to.arr && (
                  <> · {duration(minutesBetween(r.s.from.dep, r.s.to.arr))}</>
                )}
              </span>
              <Warnings list={own} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ChainView({ chain, dwell }: { chain: PlannedChain; dwell: number[] }) {
  const t = useT();
  return (
    <ol className="chain">
      {chain.connections.map((c, leg) => {
        const own = chain.warnings.filter((w) => w.legIndex === leg);
        const next = chain.connections[leg + 1];
        const at = c.sections.at(-1)!.to.name;
        return (
          <li key={leg} className="leg">
            <h3>
              {c.sections[0]!.from.name} → {at} · {duration(minutesBetween(c.dep, c.arr))} ·{' '}
              {c.transfers === 1 ? t('transfer1') : t('transfers', { n: c.transfers })}
            </h3>
            <Leg c={c} warnings={own} />
            {own.some((w) => w.sectionIndex === undefined) && (
              <div className="row">
                <span />
                <span />
                <Warnings list={own.filter((w) => w.sectionIndex === undefined)} />
              </div>
            )}
            {next && (
              <div className="stay">
                <span />
                <span className="rail" />
                <span className="what">
                  {t('stayAt', { min: duration(minutesBetween(c.arr, next.dep)), at })}
                  {(dwell[leg] ?? 0) > 0 && minutesBetween(c.arr, next.dep) > dwell[leg]! + 10 && (
                    <span className="muted"> · {t('planned', { min: duration(dwell[leg]!) })}</span>
                  )}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
