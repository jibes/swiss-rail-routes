import { useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import { parseKey } from '../core/sync';
import { LANGS, type Lang } from '../i18n';
import {
  renewKey,
  startSync,
  stopSync,
  syncAvailable,
  syncNow,
  useSync,
  type SyncStatus,
} from '../io/sync';
import { usePrefs, useT } from '../store';
import { hhmm } from './format';
import { Icon } from './icons';
import { Select } from './Select';
import { go } from './useHash';

const linkOf = (key: string) => `${location.origin}${location.pathname}#/sync/${key}`;

/** Sync turned on: its state, adding a device (QR code and key), a new key, turning it off. */
function SyncOn({
  syncKey,
  status,
  at,
}: {
  syncKey: string;
  status: SyncStatus;
  at: number | null;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState<'renew' | 'off' | null>(null);
  const [copied, setCopied] = useState(false);
  const state =
    status === 'syncing'
      ? t('syncing')
      : status === 'offline'
        ? t('syncOffline')
        : status === 'error'
          ? t('syncFailed')
          : at
            ? t('syncedAt', { time: hhmm(at) })
            : t('syncOn');
  return (
    <>
      <p className="sync-state" role="status">
        <span className={`sync-dot ${status}`} aria-hidden="true" />
        {state}
        <button type="button" className="text-button" onClick={() => void syncNow()}>
          {t('syncNow')}
        </button>
      </p>
      <button
        type="button"
        className="secondary"
        aria-expanded={show}
        onClick={() => setShow((s) => !s)}
      >
        {t('addDevice')}
      </button>
      {show && (
        <div className="sync-key">
          <p className="muted">{t('addDeviceHint')}</p>
          <div
            className="qr"
            role="img"
            aria-label={t('qrLabel')}
            // SVG made here from the link itself, no outside markup.
            dangerouslySetInnerHTML={{
              __html: renderSVG(linkOf(syncKey), { border: 2, pixelSize: 6 }),
            }}
          />
          <code className="key">{syncKey}</code>
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              await navigator.clipboard.writeText(syncKey);
              setCopied(true);
            }}
          >
            {copied ? t('copied') : t('copyKey')}
          </button>
          <p className="muted">{t('keySecret')}</p>
        </div>
      )}
      <div className="sync-actions">
        <button
          type="button"
          className={`text-button ${confirm === 'renew' ? 'danger' : ''}`}
          onClick={() => {
            if (confirm !== 'renew') return setConfirm('renew');
            setConfirm(null);
            void renewKey();
          }}
        >
          {confirm === 'renew' ? t('renewConfirm') : t('renewKey')}
        </button>
        <button
          type="button"
          className={`text-button ${confirm === 'off' ? 'danger' : ''}`}
          onClick={() => {
            if (confirm !== 'off') return setConfirm('off');
            setConfirm(null);
            void stopSync();
          }}
        >
          {confirm === 'off' ? t('syncOffConfirm') : t('syncOff')}
        </button>
      </div>
    </>
  );
}

/** Sync off: start it here, or join with the key from another device. */
function SyncOff({ offered }: { offered?: string }) {
  const t = useT();
  const [joining, setJoining] = useState(offered !== undefined);
  const [text, setText] = useState(offered ?? '');
  const valid = parseKey(text) !== null;
  return (
    <>
      <p className="muted">{t('syncIntro')}</p>
      {!joining ? (
        <div className="sync-actions">
          <button type="button" className="primary" onClick={() => void startSync()}>
            {t('syncStart')}
          </button>
          <button type="button" className="secondary" onClick={() => setJoining(true)}>
            {t('syncJoin')}
          </button>
        </div>
      ) : (
        <form
          className="sync-join"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void startSync(text);
          }}
        >
          <label>
            <span>{t('syncKeyLabel')}</span>
            <input
              value={text}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX-…"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {offered !== undefined && <p className="muted">{t('syncJoinHint')}</p>}
          <button type="submit" className="primary" disabled={!valid}>
            {t('syncJoinButton')}
          </button>
        </form>
      )}
    </>
  );
}

/** Settings: language and sync. `join` is a key from a link (`#/sync/<key>`), to confirm. */
export function Settings({ join }: { join?: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);
  const { key, status, at, loaded } = useSync();
  // Kept here: the address bar loses the key at once (below), the screen may render again first.
  const [offered] = useState(join);
  // The key from a link should not stay in the address bar or history.
  useEffect(() => {
    if (join !== undefined) history.replaceState(history.state, '', '#/settings');
  }, [join]);

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

      <section className="setting">
        <h2 className="section-label">{t('syncTitle')}</h2>
        {!syncAvailable() ? (
          <p className="muted">{t('syncUnavailable')}</p>
        ) : !loaded ? null : key ? (
          <SyncOn syncKey={key} status={status} at={at} />
        ) : (
          <SyncOff offered={offered} />
        )}
      </section>

      <p className="muted build">{t('build', { sha: __BUILD__.sha })}</p>
    </main>
  );
}
