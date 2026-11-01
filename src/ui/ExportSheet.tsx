import { useState } from 'react';
import { toGpx } from '../core/export/gpx';
import { toIcs } from '../core/export/ics';
import { sbbUrl } from '../core/export/sbb';
import type { Leg, Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import { useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';
import { shareLink } from './share';

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

/** Tickets per leg on sbb.ch. */
export function Tickets({ tour, chain, legs }: { tour: Tour; chain: PlannedChain; legs: Leg[] }) {
  const t = useT();
  return (
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
  );
}

/** Calendar (ICS) and GPX downloads, as icon buttons for a dock. */
export function ExportButtons({ tour, chain }: { tour: Tour; chain: PlannedChain }) {
  const t = useT();
  const name = tour.name || t('untitled');
  return (
    <>
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
    </>
  );
}

/** A header share button; where there is no share sheet the link is copied, and it says so. */
export function ShareButton({
  label,
  title,
  hash,
}: {
  label: string;
  title: string;
  hash: () => string | Promise<string>;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon"
      aria-label={copied ? t('copied') : label}
      onClick={async () => {
        if ((await shareLink(await hash(), title)) !== 'copied') return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon name={copied ? 'check' : 'share'} />
    </button>
  );
}
