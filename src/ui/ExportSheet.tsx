import { useState } from 'react';
import { toGpx } from '../core/export/gpx';
import { toIcs } from '../core/export/ics';
import { sbbUrl } from '../core/export/sbb';
import { encodeTour } from '../core/export/share';
import type { Leg, Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import { useT } from '../store';
import { hhmm } from './format';

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
    <section className="export" aria-label={t('export')}>
      <h2>{t('export')}</h2>
      <div className="actions">
        <button
          type="button"
          onClick={async () => {
            const url = `${location.origin}${location.pathname}${encodeTour(tour)}`;
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? t('copied') : t('share')}
        </button>
        <button
          type="button"
          onClick={() =>
            download(
              fileName(tour, 'ics'),
              'text/calendar',
              toIcs(name, chain.connections, tour.id, new Date()),
            )
          }
        >
          {t('calendar')}
        </button>
        <button
          type="button"
          onClick={() =>
            download(fileName(tour, 'gpx'), 'application/gpx+xml', toGpx(name, chain.connections))
          }
        >
          {t('gpx')}
        </button>
      </div>
      <ul className="sbb">
        {chain.connections.map((c, i) => {
          const leg = legs[i];
          if (!leg) return null;
          return (
            <li key={i}>
              <a href={sbbUrl(leg, tour.date, hhmm(c.dep))} target="_blank" rel="noreferrer">
                {t('openSbb', { from: leg.from.name, to: leg.to.name })}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
