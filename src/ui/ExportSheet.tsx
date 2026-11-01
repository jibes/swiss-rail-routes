import { useState } from 'react';
import { toGpx } from '../core/export/gpx';
import { toIcs } from '../core/export/ics';
import { sbbUrl } from '../core/export/sbb';
import { encodeTour } from '../core/export/share';
import type { Leg, Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import { useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (tour: Tour, ext: string) =>
  `${(tour.name || 'tour').replace(/[^\p{L}\p{N}]+/gu, '-')}-${tour.date}.${ext}`;

/** Tickets per leg on sbb.ch, plus the dock: calendar, GPX and the share link. */
export function ExportSheet({
  tour,
  chain,
  legs,
}: {
  tour: Tour;
  chain: PlannedChain;
  legs: Leg[];
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const name = tour.name || t('untitled');
  return (
    <>
      <section className="export" aria-label={t('export')}>
        <h2 className="section-label">{t('tickets')}</h2>
        <ul className="sbb">
          {chain.connections.map((c, i) => {
            const leg = legs[i];
            if (!leg) return null;
            return (
              <li key={i}>
                <a href={sbbUrl(leg, tour.date, hhmm(c.dep))} target="_blank" rel="noreferrer">
                  <span>{t('openSbb', { from: leg.from.name, to: leg.to.name })}</span>
                  <Icon name="external" size={18} />
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="dock">
        <div className="dock-inner">
          <button
            type="button"
            className="icon secondary"
            aria-label={t('calendar')}
            onClick={() =>
              download(
                fileName(tour, 'ics'),
                'text/calendar',
                toIcs(name, chain.connections, tour.id, new Date()),
              )
            }
          >
            <Icon name="calendar" />
          </button>
          <button
            type="button"
            className="icon secondary"
            aria-label={t('gpx')}
            onClick={() =>
              download(fileName(tour, 'gpx'), 'application/gpx+xml', toGpx(name, chain.connections))
            }
          >
            <Icon name="route" />
          </button>
          <button
            type="button"
            className="primary wide"
            onClick={async () => {
              const url = `${location.origin}${location.pathname}${encodeTour(tour)}`;
              if (navigator.share) {
                try {
                  await navigator.share({ title: name, url });
                  return;
                } catch {
                  // Cancelled or unavailable: fall back to copying.
                }
              }
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            <Icon name="share" />
            {copied ? t('copied') : t('shareTour')}
          </button>
        </div>
      </div>
    </>
  );
}
