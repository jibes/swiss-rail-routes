import { useId, useRef } from 'react';
import { legLinks } from '../core/export/sbb';
import type { Connection } from '../core/model';
import { usePrefs, useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { useModal } from './useModal';

/**
 * Prices on SBB (0.27.0): each leg of the plan as a link to sbb.ch, its tickets and prices
 * there. Prices are sbb.ch's own (0.58.0: no fare service asked in the app).
 */
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
  const box = useRef<HTMLDivElement>(null);
  // Focus in, kept inside while Tab moves, and back when it closes.
  const trap = useModal(box);
  useLayer(true, onClose);
  const links = legLinks(connections, lang);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className="sheet prices-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={trap}
      >
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
                  {l.from} → {l.to}{' '}
                  {/* Opens sbb.ch, outside the app (review of 11 Nov 2026: no cue it leaves). */}
                  <Icon name="external" size={14} />
                  <span className="sr-only">{t('opensOutside')}</span>
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
