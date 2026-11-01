export const en = {
  appName: 'Swiss Rail Day-Trip Planner',
  tagline: 'Scenic loops as one checked timetable.',
  newTour: 'New tour',
  fromTemplate: 'From template',
  noTours: 'No saved tours yet.',
  language: 'Language',
  updateReady: 'A new version is ready.',
  reload: 'Reload',
  dismiss: 'Dismiss',
  offlineReady: 'Ready to work offline.',
  build: 'Build {sha}',
  wDisruption: 'Disruption {from}–{to}',
  wReservation: 'Reservation or supplement needed {from}–{to}',
  wGaHalf: 'Not covered by GA {from}–{to}: 50 % with GA',
  wGaReduced: 'Not covered by GA {from}–{to}: reduced fare with GA',
  wGaNone: 'Not covered by GA {from}–{to}',
  wTightTransfer: 'Tight transfer in {at}: {min} min',
  wAfterSunset: '{name} passed after sunset ({time})',
  wSeasonal: 'Seasonal restrictions apply',
};

export type Catalogue = typeof en;
export type MessageKey = keyof Catalogue;
