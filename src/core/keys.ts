// Storage keys: `srr.<name>.v<N>`. Never rename one; bump the version and migrate.
export const KEYS = {
  tours: 'srr.tours.v1',
  prefs: 'srr.prefs.v1',
} as const;
