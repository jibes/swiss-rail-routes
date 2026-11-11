import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KEYS } from './core/keys';
import { pickLang, translate, type Lang, type MessageKey } from './i18n';

interface Prefs {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Show the device's location on the map: off until asked for there. */
  location: boolean;
  setLocation: (location: boolean) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      lang: pickLang(typeof navigator === 'undefined' ? [] : navigator.languages),
      setLang: (lang) => set({ lang }),
      location: false,
      setLocation: (location) => set({ location }),
    }),
    { name: KEYS.prefs, version: 1 },
  ),
);

export function useT() {
  const lang = usePrefs((s) => s.lang);
  return (key: MessageKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
}
