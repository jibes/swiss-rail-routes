import { useRegisterSW } from 'virtual:pwa-register/react';
import { log } from '../io/log';
import { useT } from '../store';
import { watchUpdates } from './updateCheck';

/** Workbox `prompt` update flow (STANDARD §2): the user decides when to reload. */
export function UpdateBanner() {
  const t = useT();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (url, r) => {
      log('sw.registered', { url });
      if (r) watchUpdates(() => r.update());
    },
    onNeedRefresh: () => log('sw.update'),
    onRegisterError: (e: unknown) => log('sw.fail', { e }),
  });

  if (!needRefresh) return null;
  return (
    <div className="banner" role="status">
      <span>{t('updateReady')}</span>
      <button
        type="button"
        className="primary"
        onClick={() => {
          log('sw.reload');
          void updateServiceWorker();
        }}
      >
        {t('reload')}
      </button>
      <button type="button" onClick={() => setNeedRefresh(false)}>
        {t('dismiss')}
      </button>
    </div>
  );
}
