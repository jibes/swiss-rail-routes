import { isRoundTrip } from '../core/tour';
import { LANGS, type Lang } from '../i18n';
import { usePrefs, useT } from '../store';
import { useTours } from '../tours';
import { longDate } from './format';
import { go } from './useHash';

export function Home() {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);
  const tours = useTours((s) => s.tours);
  const loaded = useTours((s) => s.loaded);
  const create = useTours((s) => s.create);

  return (
    <main className="page home">
      <header>
        <h1>{t('appName')}</h1>
        <p className="muted">{t('tagline')}</p>
      </header>

      <div className="actions">
        <button type="button" className="primary" onClick={() => go(`/tour/${create()}`)}>
          {t('newTour')}
        </button>
        <button type="button" onClick={() => go(`/tour/${create()}/templates`)}>
          {t('fromTemplate')}
        </button>
      </div>

      {loaded && tours.length === 0 && <p className="muted">{t('noTours')}</p>}
      <ul className="cards" aria-label={t('savedTours')}>
        {tours.map((tour) => {
          const first = tour.waypoints[0]?.name;
          const last = tour.waypoints.at(-1)?.name;
          return (
            <li key={tour.id}>
              <a href={`#/tour/${tour.id}`} className="card">
                <strong>{tour.name || t('untitled')}</strong>
                <span className="muted">{longDate(tour.date, lang)}</span>
                {first && (
                  <span className="muted">
                    {first}
                    {isRoundTrip(tour)
                      ? ` ↺ (${t('stopsCount', { n: tour.waypoints.length - 1 })})`
                      : last && last !== first
                        ? ` → ${last}`
                        : ''}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>

      <footer>
        <label>
          {t('language')}{' '}
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{t('build', { sha: __BUILD__.sha })}</span>
      </footer>
    </main>
  );
}
