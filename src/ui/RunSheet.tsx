// A train's whole run (0.45.0): a tap on a ride's train shows every stop it calls at, from where
// it starts to where it ends, the part you ride in full and the rest dimmed. One request on the
// tap (the Worker's /journey, as the live view asks); a train abroad, or one OJP does not know,
// says so.
import { useEffect, useId, useState } from 'react';
import type { Section } from '../core/model';
import { journeyQueryOf } from '../core/ojp/request';
import { wholeRun, type RunStop } from '../core/run';
import { log } from '../io/log';
import { fetchJourney } from '../io/ojp';
import { useT } from '../store';
import { badge, hhmm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';

export function RunSheet({ s, onClose }: { s: Section; onClose: () => void }) {
  const t = useT();
  const id = useId();
  useLayer(true, onClose);
  const q = s.journey ? journeyQueryOf(s.journey) : null;
  const [run, setRun] = useState<RunStop[] | 'none' | null>(q ? null : 'none');
  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    log('run.open', { journey: s.journey });
    fetchJourney(q, ctrl.signal).then(
      (j) => setRun(j.calls.length ? wholeRun(j.calls, s) : 'none'),
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        log('run.fail', { journey: s.journey, e });
        setRun('none');
      },
    );
    return () => ctrl.abort();
    // One request per sheet: the ride does not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet run-sheet" role="dialog" aria-modal="true" aria-labelledby={id}>
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
