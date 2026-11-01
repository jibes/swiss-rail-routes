import { LANGS, type Lang } from '../i18n';
import { usePrefs, useT } from '../store';

export function Home() {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);

  return (
    <main className="home">
      <header>
        <h1>{t('appName')}</h1>
        <p className="muted">{t('tagline')}</p>
      </header>

      <div className="actions">
        <button type="button" className="primary" disabled>
          {t('newTour')}
        </button>
        <button type="button" disabled>
          {t('fromTemplate')}
        </button>
      </div>

      <p className="muted">{t('noTours')}</p>

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
