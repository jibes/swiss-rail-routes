import { useId } from 'react';
import { legLinks } from '../core/export/sbb';
import type { Connection } from '../core/model';
import { usePrefs, useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';

/** Prices on SBB (0.27.0): each leg of the plan as a link to sbb.ch, its tickets and prices. */
export function PricesSheet({
  connections,
  onClose,
}: {
  connections: Connection[];
  onClose: () => void;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const id = useId();
  useLayer(true, onClose);
  const links = legLinks(connections, lang);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet prices-sheet" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sheet-head">
          <h2 id={id}>{t('pricesOnSbb')}</h2>
          <button type="button" className="icon" aria-label={t('close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">{t('pricesHint')}</p>
        <ul className="prices">
          {links.map((l, i) => (
            <li key={i}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="result">
                <span className="r-name">
                  {l.from} → {l.to}
                </span>
                <span className="r-sub">{t('pricesLeg', { time: hhmm(l.dep) })}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
