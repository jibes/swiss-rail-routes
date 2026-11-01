import type { RouteTemplate } from '../core/data';
import type { Connection, Section } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import type { Warning } from '../core/warnings';
import { usePrefs, useT } from '../store';
import { duration, hhmm, minutesBetween } from './format';
import { TEMPLATES } from './TemplatePicker';

const CHIP: Record<Warning['severity'], string> = { error: 'red', warn: 'amber', info: 'grey' };

function Chips({ list }: { list: Warning[] }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  if (!list.length) return null;
  return (
    <ul className="chips">
      {list.map((w, i) => (
        <li key={i} className={`chip ${CHIP[w.severity]}`}>
          {w.type === 'seasonal'
            ? (TEMPLATES.find((x: RouteTemplate) => x.id === w.params.template)?.season?.note[
                lang
              ] ?? t(w.key, w.params))
            : t(w.key, w.params)}
        </li>
      ))}
    </ul>
  );
}

/** "R62", "IC3"; numeric lines with their category: "CC 63" (cog), "PB 2461" (cable car). */
const badge = (s: Section) =>
  s.line && /[A-Za-z]/.test(s.line)
    ? s.line
    : [s.category, s.line ?? s.number].filter(Boolean).join(' ');

function SectionRow({ s, warnings }: { s: Section; warnings: Warning[] }) {
  const t = useT();
  if (s.mode === 'walk')
    return (
      <li className="sec walk">
        {t('walk')} {s.to.name !== s.from.name ? `→ ${s.to.name}` : ''}
      </li>
    );
  return (
    <li className="sec">
      <div className="sec-row">
        <time>{s.from.dep ? hhmm(s.from.dep) : '–'}</time>
        <span>{s.from.name}</span>
        {s.from.platform && <span className="muted">{t('platform', { p: s.from.platform })}</span>}
      </div>
      <div className="sec-line">
        <span className="badge">{badge(s)}</span>
        {s.operator && <span className="muted">{s.operator}</span>}
        {s.intermediate.length > 0 && (
          <span className="muted">{t('stopsBetween', { n: s.intermediate.length })}</span>
        )}
      </div>
      <div className="sec-row">
        <time>{s.to.arr ? hhmm(s.to.arr) : '–'}</time>
        <span>{s.to.name}</span>
        {s.to.platform && <span className="muted">{t('platform', { p: s.to.platform })}</span>}
      </div>
      <Chips list={warnings} />
    </li>
  );
}

export function ChainView({ chain, dwell }: { chain: PlannedChain; dwell: number[] }) {
  const t = useT();
  return (
    <ol className="chain">
      {chain.connections.map((c: Connection, leg) => {
        const own = chain.warnings.filter((w) => w.legIndex === leg);
        const next = chain.connections[leg + 1];
        return (
          <li key={leg} className="leg">
            <h3>
              {c.sections[0]!.from.name} → {c.sections.at(-1)!.to.name}{' '}
              <span className="muted">
                {duration(minutesBetween(c.dep, c.arr))} ·{' '}
                {c.transfers === 1 ? t('transfer1') : t('transfers', { n: c.transfers })}
              </span>
            </h3>
            <ol>
              {c.sections.map((s, i) => (
                <SectionRow key={i} s={s} warnings={own.filter((w) => w.sectionIndex === i)} />
              ))}
            </ol>
            <Chips list={own.filter((w) => w.sectionIndex === undefined)} />
            {next && (
              <p className="dwell">
                {t('stayAt', {
                  min: minutesBetween(c.arr, next.dep),
                  at: c.sections.at(-1)!.to.name,
                })}
                {dwell[leg]! > 0 && (
                  <span className="muted"> ({t('minutes', { n: dwell[leg]! })})</span>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
