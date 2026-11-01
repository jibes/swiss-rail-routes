import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../store';

/** Workbox `prompt` update flow (STANDARD §2): the user decides when to reload. */
export function UpdateBanner() {
  const t = useT();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div className="banner" role="status">
      <span>{t('updateReady')}</span>
      <button type="button" className="primary" onClick={() => void updateServiceWorker()}>
        {t('reload')}
      </button>
      <button type="button" onClick={() => setNeedRefresh(false)}>
        {t('dismiss')}
      </button>
    </div>
  );
}
