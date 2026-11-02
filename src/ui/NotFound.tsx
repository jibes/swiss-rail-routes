import { useT } from '../store';
import { go } from './useHash';

export function NotFound() {
  const t = useT();
  return (
    <main className="page">
      <p>{t('notFound')}</p>
      <button type="button" className="secondary" onClick={() => go('/')}>
        {t('back')}
      </button>
    </main>
  );
}
