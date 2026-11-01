import type { Catalogue } from './en';

export const fr = {
  appName: 'Excursions en train en Suisse',
  tagline: 'Des boucles panoramiques en un seul horaire vérifié.',
  newTour: 'Nouveau circuit',
  fromTemplate: 'Depuis un modèle',
  noTours: 'Aucun circuit enregistré.',
  language: 'Langue',
  updateReady: 'Une nouvelle version est prête.',
  reload: 'Recharger',
  dismiss: 'Fermer',
  offlineReady: 'Prêt pour une utilisation hors ligne.',
  build: 'Build {sha}',
  wDisruption: 'Perturbation {from}–{to}',
  wReservation: 'Réservation ou supplément requis {from}–{to}',
  wGaHalf: 'Hors AG {from}–{to} : 50 % avec l’AG',
  wGaReduced: 'Hors AG {from}–{to} : tarif réduit avec l’AG',
  wGaNone: 'Hors AG {from}–{to}',
  wTightTransfer: 'Correspondance serrée à {at} : {min} min',
  wAfterSunset: '{name} après le coucher du soleil ({time})',
  wSeasonal: 'Restrictions saisonnières',
} satisfies Catalogue;
