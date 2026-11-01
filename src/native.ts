// The one switch between the web app and the Android shell (apps-data STANDARD.md §7).
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
