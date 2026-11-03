import { useState } from 'react';
import { toIcs } from '../core/export/ics';
import type { Tour } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import { useT } from '../store';
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

/** The trip in the calendar: one event per train (ICS, made on the device). */
export function downloadIcs(tour: Tour, name: string, chain: PlannedChain, uid: string) {
  download(fileName(tour, 'ics'), 'text/calendar', toIcs(name, chain.connections, uid, new Date()));
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
    <>
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
      {/* Said and shown: the icon's change alone is easy to miss. */}
      <div className="toast" role="status" hidden={!copied}>
        <span>{copied ? t('copied') : ''}</span>
      </div>
    </>
  );
}
