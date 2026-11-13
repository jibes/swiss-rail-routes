// Share (0.61.0): what leaves the app, in one place. The trip's link (shared, or copied where
// there is no share sheet), its trains in the calendar (.ics), a printout, and each leg on
// sbb.ch with its tickets and prices there (0.27.0). The More menu keeps the trip's own actions.
import { useId, useRef, useState } from 'react';
import { legLinks } from '../core/export/sbb';
import type { PlannedTrip } from '../core/trip';
import { log } from '../io/log';
import { shareHash } from '../io/refresh';
import { usePrefs, useT } from '../store';
import { downloadIcs } from './ExportSheet';
import { hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { shareLink } from './share';
import { useModal } from './useModal';

export function ShareSheet({
  trip,
  name,
  part,
  onClose,
}: {
  trip: PlannedTrip;
  name: string;
  /** What leaves the app (link, calendar, print), or the tickets on sbb.ch (review, 0.66.0:
   * buying is not sharing; the prices sat in the share sheet). */
  part: 'share' | 'tickets';
  onClose: () => void;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // Focus in, kept inside while Tab moves, and back when it closes.
  const trap = useModal(box);
  useLayer(true, onClose);
  const [copied, setCopied] = useState(false);
  const links = legLinks(trip.chain.connections, lang);

  const send = async () => {
    log('share.link', { trip: trip.id });
    if ((await shareLink(await shareHash(trip), name)) !== 'copied') return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className="sheet share-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={trap}
      >
        <div className="sheet-head">
          <h2 id={id}>{t(part === 'share' ? 'shareTrip' : 'pricesOnSbb')}</h2>
          <button type="button" className="icon" aria-label={t('close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {part === 'share' && (
          <>
            <div className="share-acts">
              <button type="button" className="pill" onClick={() => void send()}>
                <Icon name={copied ? 'check' : 'share'} size={18} />
                {copied ? t('copied') : t('sendLink')}
              </button>
              <button
                type="button"
                className="pill"
                onClick={() => {
                  log('export.ics', { trip: trip.id });
                  downloadIcs(trip.route, name, trip.chain, trip.id);
                }}
              >
                <Icon name="calendar" size={18} />
                {t('calendar')}
              </button>
              <button
                type="button"
                className="pill"
                onClick={() => {
                  log('trip.print', { trip: trip.id });
                  onClose();
                  // After the sheet has gone, so it is not on the page.
                  requestAnimationFrame(() => window.print());
                }}
              >
                <Icon name="print" size={18} />
                {t('print')}
              </button>
            </div>
            {/* Said and shown: the icon's change alone is easy to miss. */}
            <p className="sr-only" role="status">
              {copied ? t('copied') : ''}
            </p>
          </>
        )}
        {part === 'tickets' && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
