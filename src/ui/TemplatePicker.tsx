import { useState } from 'react';
import type { RouteTemplate } from '../core/data';
import { usePrefs, useT } from '../store';
import templatesJson from '../data/templates.json';

export const TEMPLATES = templatesJson.templates as RouteTemplate[];

export function TemplatePicker({
  onPick,
  month,
}: {
  onPick: (t: RouteTemplate, reversed: boolean) => void;
  month: number;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const [reversed, setReversed] = useState(false);
  return (
    <section className="templates" aria-label={t('addRoute')}>
      <h2>{t('addRoute')}</h2>
      <label className="switch">
        <input type="checkbox" checked={reversed} onChange={(e) => setReversed(e.target.checked)} />{' '}
        {t('reverse')}
      </label>
      <ul>
        {TEMPLATES.map((tp) => {
          const a = tp.chain[0]!;
          const b = tp.chain.at(-1)!;
          const [from, to] = reversed ? [b, a] : [a, b];
          const seasonal = tp.season?.months.includes(month);
          return (
            <li key={tp.id}>
              <button type="button" onClick={() => onPick(tp, reversed)}>
                <strong>{tp.name}</strong>
                <span className="muted">
                  {from.name} → {to.name}
                </span>
                {seasonal && <span className="chip info">{tp.season!.note[lang]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
