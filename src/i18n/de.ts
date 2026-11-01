import type { Catalogue } from './en';

export const de = {
  appName: 'Bahn-Tagesausflug Schweiz',
  tagline: 'Panoramaschlaufen als ein geprüfter Fahrplan.',
  newTour: 'Neue Tour',
  fromTemplate: 'Aus Vorlage',
  noTours: 'Noch keine gespeicherten Touren.',
  language: 'Sprache',
  updateReady: 'Eine neue Version ist bereit.',
  reload: 'Neu laden',
  dismiss: 'Schliessen',
  offlineReady: 'Bereit für den Offline-Betrieb.',
  build: 'Build {sha}',
  wDisruption: 'Störung {from}–{to}',
  wReservation: 'Reservation oder Zuschlag nötig {from}–{to}',
  wGaHalf: 'Nicht im GA {from}–{to}: 50 % mit GA',
  wGaReduced: 'Nicht im GA {from}–{to}: ermässigt mit GA',
  wGaNone: 'Nicht im GA {from}–{to}',
  wTightTransfer: 'Knapper Umstieg in {at}: {min} Min.',
  wAfterSunset: '{name} nach Sonnenuntergang ({time})',
  wSeasonal: 'Saisonale Einschränkungen',
} satisfies Catalogue;
