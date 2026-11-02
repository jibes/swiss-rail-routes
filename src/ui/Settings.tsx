import { LANGS, type Lang } from '../i18n';
import { usePrefs, useT } from '../store';
import { Icon } from './icons';
import { Select } from './Select';
import { go } from './useHash';

/** Settings: the language. */
export function Settings() {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);
  return (
    <main className="page settings">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
        <h1>{t('settings')}</h1>
      </header>
      <section className="setting">
        <h2 className="section-label">{t('language')}</h2>
        <Select
          className="pill"
          label={t('language')}
          value={lang}
          options={LANGS.map((l) => ({ value: l, label: t(`lang_${l}`) }))}
          onChange={(l) => setLang(l as Lang)}
        />
      </section>
      <p className="muted build">{t('build', { sha: __BUILD__.sha })}</p>
    </main>
  );
}
