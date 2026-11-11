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
