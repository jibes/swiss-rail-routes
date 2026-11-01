import type { Catalogue } from './en';

export const it = {
  appName: 'Gite in treno in Svizzera',
  tagline: 'Giri panoramici in un unico orario verificato.',
  newTour: 'Nuovo giro',
  fromTemplate: 'Da modello',
  noTours: 'Nessun giro salvato.',
  language: 'Lingua',
  updateReady: 'È pronta una nuova versione.',
  reload: 'Ricarica',
  dismiss: 'Chiudi',
  offlineReady: 'Pronto per l’uso offline.',
  build: 'Build {sha}',
  wDisruption: 'Perturbazione {from}–{to}',
  wReservation: 'Prenotazione o supplemento richiesti {from}–{to}',
  wGaHalf: 'Non coperto dall’AG {from}–{to}: 50 % con l’AG',
  wGaReduced: 'Non coperto dall’AG {from}–{to}: tariffa ridotta con l’AG',
  wGaNone: 'Non coperto dall’AG {from}–{to}',
  wTightTransfer: 'Coincidenza stretta a {at}: {min} min',
  wAfterSunset: '{name} dopo il tramonto ({time})',
  wSeasonal: 'Limitazioni stagionali',
} satisfies Catalogue;
