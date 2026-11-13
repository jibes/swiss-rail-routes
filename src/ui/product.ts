// A ride's kind as OJP names it (its ProductCategory, in German), said in the app's language
// where it is a kind, not a train's own name (review of 11 Nov 2026: "Ersatzverkehr" and
// "Zahnradbahn" in the English app). Named trains and the international names stay as they are.
import type { useT } from '../store';

const KINDS = {
  Zahnradbahn: 'catCog',
  Regio: 'catRegio',
  Bus: 'catBus',
  Ersatzverkehr: 'catReplacement',
  Pendelbahn: 'catCableCar',
  Schiff: 'catBoat',
  Tram: 'catTram',
  Gondelbahn: 'catGondola',
  Nachtbus: 'catNightBus',
  Standseilbahn: 'catFunicular',
  Sesselbahn: 'catChairlift',
} as const;

export function productText(t: ReturnType<typeof useT>, product: string): string {
  const k = (KINDS as Record<string, (typeof KINDS)[keyof typeof KINDS]>)[product];
  return k ? t(k) : product;
}

/**
 * The kind the badge says already (review, 0.66.0: "IC8 InterCity", "R62 Regio" took the width a
 * long destination needed): left out. Named trains (Luzern-Interlaken Express, Mont-Blanc
 * Express), replacement buses and kinds abroad stay.
 */
const SAID_BY_BADGE: Record<string, string> = {
  IC: 'InterCity',
  IR: 'InterRegio',
  RE: 'RegioExpress',
  R: 'Regio',
  S: 'S-Bahn',
  EC: 'EuroCity',
  ICE: 'InterCityExpress',
};

export function saidByBadge(category: string | undefined, product: string): boolean {
  return !!category && SAID_BY_BADGE[category]?.toLowerCase() === product.toLowerCase();
}
