import { useState } from 'react';
import { toGpx } from '../core/export/gpx';
import { toIcs } from '../core/export/ics';
import { sbbUrl } from '../core/export/sbb';
import { encodeTour } from '../core/export/share';
import type { Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import { expandLegs } from '../core/tour';
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

export function ExportSheet({ tour, chain }: { tour: Tour; chain: PlannedChain }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const legs = expandLegs(tour);
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
        {chain.connections.map((c, i) => (
          <li key={i}>
            <a href={sbbUrl(legs[i]!, tour.date, hhmm(c.dep))} target="_blank" rel="noreferrer">
              {t('openSbb', { from: legs[i]!.from.name, to: legs[i]!.to.name })}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
