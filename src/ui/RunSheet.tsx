// A train's whole run (0.45.0): a tap on a ride's train shows every stop it calls at, from where
// it starts to where it ends, the part you ride in full and the rest dimmed. One request on the
// tap (the Worker's /journey, as the live view asks); a train abroad, or one OJP does not know,
// says so.
import { useEffect, useId, useRef, useState } from 'react';
import type { Section } from '../core/model';
import { journeyQueryOf } from '../core/ojp/request';
import { UnknownJourneyError } from '../core/ojp/journey';
import { wholeRun, type RunStop } from '../core/run';
import { log } from '../io/log';
import { fetchJourney } from '../io/ojp';
import { useT } from '../store';
import { badge, hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { useModal } from './useModal';

export function RunSheet({ s, onClose }: { s: Section; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // Focus in, kept inside while Tab moves, and back when it closes.
  const trap = useModal(box);
  useLayer(true, onClose);
  const q = s.journey ? journeyQueryOf(s.journey) : null;
  // 'none': a train the service does not know (abroad, unknown); 'failed': the service did not
  // answer (reported in review: that was blamed on the train, with no way to ask again).
  const [run, setRun] = useState<RunStop[] | 'none' | 'failed' | null>(q ? null : 'none');
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    log('run.open', { journey: s.journey, again: asked > 0 });
    fetchJourney(q, ctrl.signal).then(
      (j) => setRun(j.calls.length ? wholeRun(j.calls, s) : 'none'),
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        log('run.fail', { journey: s.journey, e });
        setRun(e instanceof UnknownJourneyError ? 'none' : 'failed');
      },
    );
    return () => ctrl.abort();
    // One request per sheet and tap on Try again: the ride does not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className="sheet run-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={trap}
      >
        <div className="sheet-head">
          <h2 id={id}>
            <span className="badge">{badge(s)}</span> {s.destination ?? s.to.name}
          </h2>
          <button type="button" className="icon" aria-label={t('close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {run === null && <p className="muted">{t('runAsking')}</p>}
        {run === 'none' && <p className="muted">{t('runUnknown')}</p>}
        {run === 'failed' && (
          <div className="notice">
            <p>{t('planServer')}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRun(null);
                setAsked((n) => n + 1);
              }}
            >
              {t('retry')}
            </button>
          </div>
        )}
        {Array.isArray(run) && (
          <ol className="run" aria-label={t('runLabel')}>
            {run.map((x, i) => (
              <li key={i} className={x.yours ? 'yours' : 'other'}>
                <time>{x.dep ? hhmm(x.dep) : x.arr ? hhmm(x.arr) : ''}</time>
                <span>{x.name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
