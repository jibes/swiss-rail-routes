import { useT } from '../store';
import { Icon } from './icons';
import { useHash } from './useHash';

/** Routes (where) and Trips (when): the app's two collections. */
export function TabBar() {
  const t = useT();
  const hash = useHash();
  const trips = hash.startsWith('/trips');
  return (
    <nav className="tabbar" aria-label={t('sections')}>
      <a href="#/" aria-current={!trips ? 'page' : undefined}>
        <Icon name="route" />
        <span>{t('routes')}</span>
      </a>
      <a href="#/trips" aria-current={trips ? 'page' : undefined}>
        <Icon name="calendar" />
        <span>{t('trips')}</span>
      </a>
    </nav>
  );
}
