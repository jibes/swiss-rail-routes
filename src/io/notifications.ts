// Trip notifications in the Android app (local, scheduled from the timetable; none on the web).
import { LocalNotifications } from '@capacitor/local-notifications';
import { noticesFor, type Notice } from '../core/notify';
import type { Trip } from '../core/trip';
import { TEMPLATES } from '../data';
import { translate, type Lang } from '../i18n';
import { isNative } from '../native';
import { stopSearch } from './stops';
import { stopKey } from '../core/stops';

const CHANNEL = 'trip';

function text(n: Notice, lang: Lang) {
  const t = (k: Parameters<typeof translate>[1], p: Record<string, string> = {}) =>
    translate(lang, k, p);
  const p = n.params;
  if (n.kind === 'depart')
    return {
      title: t('nDepartTitle', p),
      body: t('nDepartBody', {
        from: p.from ?? '',
        platform: p.platform ? ` · ${t('platform', { p: p.platform })}` : '',
      }),
    };
  if (n.kind === 'exit') return { title: t('nExitTitle', p), body: t('nExitBody', p) };
  const side = p.side === 'R' ? t('nSideRight') : p.side === 'L' ? t('nSideLeft') : '';
  const sun = p.sunset ? t('nSunset', { time: p.sunset }) : '';
  return { title: t('nHighlightTitle', p), body: [side, sun].filter(Boolean).join(' · ') };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Replaces all scheduled trip notifications with those of `trips` still to come: also with none
 * (the last upcoming trip deleted, here or through sync). Calls run one after another, so an
 * older one never schedules after a newer one cancelled. Never asks for permission itself.
 */
export function scheduleTrips(trips: Trip[], lang: Lang, now = Date.now()): Promise<unknown> {
  if (!isNative) return Promise.resolve();
  queue = queue.then(() => reschedule(trips, lang, now)).catch(() => undefined);
  return queue;
}

async function reschedule(trips: Trip[], lang: Lang, now: number) {
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  const index = await stopSearch();
  const notices = trips.flatMap((t) =>
    noticesFor(t, now, TEMPLATES, (r) => index.byRef(stopKey(r))),
  );
  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: translate(lang, 'nChannel'),
    importance: 4,
    vibration: true,
  });
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length)
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    });
  if (!notices.length) return;
  await LocalNotifications.schedule({
    notifications: notices.map((n) => ({
      id: n.id,
      channelId: CHANNEL,
      ...text(n, lang),
      schedule: { at: new Date(n.at), allowWhileIdle: true },
      extra: { tripId: n.tripId },
    })),
  });
}

/** Asks for notifications once, when a trip is saved (the moment they make sense). */
export async function askNotifications(): Promise<void> {
  if (!isNative) return;
  const perm = await LocalNotifications.checkPermissions().catch(() => null);
  if (perm?.display === 'prompt') await LocalNotifications.requestPermissions().catch(() => null);
}

/** Tapping a notification opens "Now" for its trip. */
export function onNotificationTap(go: (tripId: string) => void) {
  if (!isNative) return () => undefined;
  const h = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const id = (a.notification.extra as { tripId?: string } | undefined)?.tripId;
    if (id) go(id);
  });
  return () => void h.then((x) => x.remove());
}
