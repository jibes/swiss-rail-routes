// Storage keys: `srr.<name>.v<N>`. Never rename one; bump the version and migrate.
export const KEYS = {
  prefs: 'srr.prefs.v1',
  /** Stations you added lately (0.48.0), on this device only, not synced. */
  recentStops: 'srr.recentStops.v1',
} as const;
