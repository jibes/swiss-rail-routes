// The one switch between the web app and the Android shell (apps-data STANDARD.md §7).
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/**
 * Where the web app lives, for links that leave the device (shares, the sync QR code). In the
 * Android app the page itself is https://localhost, which no one else can open.
 */
export const publicUrl = () =>
  isNative
    ? (import.meta.env.VITE_PUBLIC_URL ?? 'https://jibes.github.io/swiss-rail-routes/')
    : `${location.origin}${location.pathname}`;
