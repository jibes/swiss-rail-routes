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
        <button type="button" onClick={() => go('/')}>
          {t('back')}
        </button>
      </main>
    );
  const { id: _id, ...rest } = tour;
  return (
    <main className="page">
      <h1>{tour.name || t('untitled')}</h1>
      <p className="muted">{t('sharedTour')}</p>
      <ol className="waypoints">
        {tour.waypoints.map((w, i) => (
          <li key={i} className={`wp wp-${w.kind}`}>
            <span className="wp-name">{w.name}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="primary" onClick={() => go(`/tour/${create(rest)}`)}>
        {t('importTour')}
      </button>
    </main>
  );
}
