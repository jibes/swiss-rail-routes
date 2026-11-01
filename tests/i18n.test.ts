import { describe, expect, it } from 'vitest';
import { CATALOGUES, LANGS, pickLang, translate } from '../src/i18n';

describe('i18n', () => {
  it('every catalogue has the same keys, all non-empty', () => {
    const keys = Object.keys(CATALOGUES.en).sort();
    for (const lang of LANGS) {
      const cat = CATALOGUES[lang];
      expect(Object.keys(cat).sort()).toEqual(keys);
      for (const v of Object.values(cat)) expect(v.trim()).not.toBe('');
    }
  });

  it('picks the first supported browser language', () => {
    expect(pickLang(['rm-CH', 'de-CH', 'en'])).toBe('de');
    expect(pickLang(['fr'])).toBe('fr');
    expect(pickLang(['ja'])).toBe('en');
    expect(pickLang([])).toBe('en');
  });

  it('fills parameters and leaves unknown ones', () => {
    expect(translate('en', 'build', { sha: 'abc123' })).toBe('Build abc123');
    expect(translate('en', 'build')).toBe('Build {sha}');
  });
});
