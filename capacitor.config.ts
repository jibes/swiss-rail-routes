import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Permanent: changing it breaks updates for installed apps.
  appId: 'ch.brunodev.swissrailroutes',
  appName: 'Rail Day Trip',
  webDir: 'dist',
  // The WebView's console reaches the system log in debug builds only.
  loggingBehavior: 'debug',
  android: {
    backgroundColor: '#0d0e10',
    // The styles need color-mix(), dvh and :has() (Chrome 111).
    minWebViewVersion: 111,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_rail',
      iconColor: '#D40000',
    },
  },
};

export default config;
