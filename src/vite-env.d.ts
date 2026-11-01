/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const __BUILD__: { sha: string; time: string };

interface ImportMetaEnv {
  /** OJP Worker base URL, e.g. `https://srr-ojp.<account>.workers.dev`. Empty: planning is off. */
  readonly VITE_OJP_URL?: string;
  /** Public web address for links made in the Android app (default: the GitHub Pages site). */
  readonly VITE_PUBLIC_URL?: string;
}
