import { decodeTour } from '../core/export/share';
import { useT } from '../store';
import { useTours } from '../tours';
import { go } from './useHash';

/** `#/t/<data>`: a tour someone shared. Saving makes it a new tour of this device. */
export function SharedTour({ hash }: { hash: string }) {
  const t = useT();
  const create = useTours((s) => s.create);
  const tour = decodeTour(`#${hash}`, 'shared');
  if (!tour)
    return (
      <main className="page">
        <p role="alert">{t('sharedBroken')}</p>
        <button type="button" className="secondary" onClick={() => go('/')}>
          {t('back')}
        </button>
      </main>
    );
  const { id: _id, ...rest } = tour;
  return (
    <main className="page">
      <header className="hero">
        <h1>{tour.name || t('untitled')}</h1>
        <p>{t('sharedTour')}</p>
      </header>
      <ol className="line">
        {tour.waypoints.map((w, i) => (
          <li
            key={i}
            className={`stop ${w.kind === 'via' ? 'via' : ''} ${i === tour.waypoints.length - 1 ? 'last' : ''}`}
          >
            <span className="dot" aria-hidden="true" />
            <div className="stop-head">
              <span className="stop-name">
                <span>{w.name}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="dock">
        <div className="dock-inner">
          <button
            type="button"
            className="primary wide"
            onClick={() => go(`/tour/${create(rest)}`)}
          >
            {t('importTour')}
          </button>
        </div>
      </div>
    </main>
  );
}
