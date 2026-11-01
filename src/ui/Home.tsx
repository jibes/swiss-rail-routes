import type { Tour } from '../core/model';
import { isRoundTrip } from '../core/tour';
import { LANGS, type Lang } from '../i18n';
import { usePrefs, useT } from '../store';
import { useTours } from '../tours';
import { longDate } from './format';
import { Icon } from './icons';
import { TabBar } from './TabBar';
import { go } from './useHash';

/** The tour drawn as a tiny line: solid dots where you get off, rings where you ride through. */
export function MiniLine({ tour }: { tour: Tour }) {
  const pts = tour.waypoints;
  return (
    <span className="mini-line" aria-hidden="true">
      {pts.map((w, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <i />}
          <b className={w.kind === 'via' ? 'via' : ''} />
        </span>
      ))}
    </span>
  );
}

function EmptyLine() {
  return (
    <svg width="160" height="40" viewBox="0 0 160 40" aria-hidden="true">
      <path d="M12 20h136" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="20" r="7" fill="currentColor" />
      <circle cx="62" cy="20" r="5" fill="var(--bg)" stroke="currentColor" strokeWidth="2" />
      <circle cx="104" cy="20" r="5" fill="var(--bg)" stroke="currentColor" strokeWidth="2" />
      <circle cx="148" cy="20" r="7" fill="currentColor" />
    </svg>
  );
}

export function Home() {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);
  const tours = useTours((s) => s.tours);
  const create = useTours((s) => s.create);

  return (
    <main className="page home with-tabs">
      <header className="hero">
        <h1>{t('routes')}</h1>
        <p>{t('tagline')}</p>
      </header>

      {tours.length === 0 ? (
        <div className="empty">
          <EmptyLine />
          <p>{t('noTours')}</p>
        </div>
      ) : (
        <ul className="tours" aria-label={t('savedTours')}>
          {tours.map((tour) => {
            const first = tour.waypoints[0]?.name;
            const last = tour.waypoints.at(-1)?.name;
            const route = !first
              ? ''
              : isRoundTrip(tour)
                ? `${first} ↺`
                : last && last !== first
                  ? `${first} → ${last}`
                  : first;
            return (
              <li key={tour.id}>
                <a href={`#/tour/${tour.id}`} className="tour-card">
                  <strong>{tour.name || t('untitled')}</strong>
                  {tour.waypoints.length > 1 && <MiniLine tour={tour} />}
                  <span className="meta">
                    {longDate(tour.date, lang)}
                    {route && ` · ${route}`}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="home-foot">
        <label>
          <span className="sr-only">{t('language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <span>{t('build', { sha: __BUILD__.sha })}</span>
      </footer>

      <div className="dock">
        <div className="dock-inner">
          <button
            type="button"
            className="secondary"
            onClick={() => go(`/tour/${create()}/templates`)}
          >
            {t('fromTemplate')}
          </button>
          <button type="button" className="primary wide" onClick={() => go(`/tour/${create()}`)}>
            <Icon name="plus" />
            {t('newTour')}
          </button>
        </div>
      </div>
      <TabBar />
    </main>
  );
}
