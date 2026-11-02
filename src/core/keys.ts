// Storage keys: `srr.<name>.v<N>`. Never rename one; bump the version and migrate.
export const KEYS = {
  prefs: 'srr.prefs.v1',
} as const;
