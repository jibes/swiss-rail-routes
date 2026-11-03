import { useT } from '../store';
import { go } from './useHash';
import { Icon } from './icons';

export function NotFound() {
  const t = useT();
  return (
    <main className="page">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
      </header>
      <p>{t('notFound')}</p>
    </main>
  );
}
