import { useId, useRef, useState } from 'react';
import { legLinks } from '../core/export/sbb';
import type { Connection } from '../core/model';
import { cheapest, fareQueryOf, type Fare } from '../core/ojp/fare';
import { fetchFare } from '../io/ojp';
import { usePrefs, useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { useModal } from './useModal';

/** A leg's cheapest tickets, without and with Half Fare; null while asked, 'none' when unknown. */
type LegFares = { full: Fare[]; half: Fare[] } | 'none' | null;

/**
 * Prices on SBB (0.27.0): each leg of the plan as a link to sbb.ch, its tickets and prices.
 * Show prices (0.31.0) asks SBB's fare service for each leg's cheapest tickets, once, on a tap:
 * two questions a leg (without and with Half Fare), never on its own.
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
  const [fares, setFares] = useState<LegFares[] | null>(null);

  const ask = () => {
    setFares(links.map(() => null));
    links.forEach((l, i) => {
      const c = connections[l.at]!;
      const full = fareQueryOf(c, false);
      const half = fareQueryOf(c, true);
      const done = (v: LegFares) => setFares((f) => f && f.map((x, j) => (j === i ? v : x)));
      if (!full || !half) return done('none');
      Promise.all([fetchFare(full), fetchFare(half)]).then(
        ([a, b]) => done(a.length || b.length ? { full: a, half: b } : 'none'),
        () => done('none'),
      );
    });
  };

  const chf = (f: Fare | undefined) => (f ? f.price.toFixed(2) : '–');
  const priceLines = (v: LegFares) => {
    if (v === null) return <span className="r-sub muted">{t('pricesAsking')}</span>;
    if (v === 'none') return <span className="r-sub muted">{t('pricesNone')}</span>;
    return ([2, 1] as const).map((cls) => (
      <span key={cls} className={`r-sub fare${cls === 2 ? ' fare-main' : ''}`}>
        {t('pricesClass', {
          cls: t(cls === 2 ? 'class2' : 'class1'),
          full: chf(cheapest(v.full, cls)),
          half: chf(cheapest(v.half, cls)),
        })}
        {cls === 2 && cheapest(v.full, 2)?.name && (
          <span className="muted"> · {cheapest(v.full, 2)!.name}</span>
        )}
      </span>
    ));
  };

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
        <p className="muted">{fares ? t('pricesFareNote') : t('pricesHint')}</p>
        <ul className="prices">
          {links.map((l, i) => (
            <li key={i}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="result">
                <span className="r-name">
                  {l.from} → {l.to}
                  {/* Opens sbb.ch, outside the app (review of 11 Nov 2026: no cue it leaves). */}
                  <Icon name="external" size={14} />
                  <span className="sr-only">{t('opensOutside')}</span>
                </span>
                <span className="r-sub">{t('pricesLeg', { time: hhmm(l.dep) })}</span>
                {fares && priceLines(fares[i] ?? 'none')}
              </a>
            </li>
          ))}
        </ul>
        {!fares && links.length > 0 && (
          <button type="button" className="pill wide" onClick={ask}>
            {t('showPrices')}
          </button>
        )}
      </div>
    </div>
  );
}
