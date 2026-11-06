import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Permanent: changing it breaks updates for installed apps.
  appId: 'ch.brunodev.swissrailroutes',
  appName: 'Viadukt',
  webDir: 'dist',
  // The WebView's console reaches the system log in release builds too: the app logs little,
  // and the smoke test needs its 'srr:ready' line and any error.
  loggingBehavior: 'production',
  android: {
    // The light theme's page colour; dark mode paints its own at once.
    backgroundColor: '#f7f7f5',
    // The styles need color-mix(), dvh and :has() (Chrome 111).
    minWebViewVersion: 111,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_rail',
      iconColor: '#D40000', // logo V14's red
    },
  },
};

export default config;
