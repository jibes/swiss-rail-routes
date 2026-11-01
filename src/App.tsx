import { lazy, Suspense, useEffect, useRef } from 'react';
import { usePrefs } from './store';
import { useTours } from './tours';
import { Builder } from './ui/Builder';
import { Home } from './ui/Home';
import { SharedTour } from './ui/SharedTour';
import { SharedTrip } from './ui/SharedTrip';
import { Timeline } from './ui/Timeline';
import { Trips } from './ui/Trips';
import { TripView } from './ui/TripView';
import { EditTrip } from './ui/EditTrip';
import { liveTrip } from './core/trip';
import { onNotificationTap, scheduleTrips } from './io/notifications';
import { isNative } from './native';
import { useTrips } from './trips';
import { UpdateBanner } from './ui/UpdateBanner';
import { useHash } from './ui/useHash';

const MapView = lazy(() => import('./ui/MapView'));

function Route({ hash: full }: { hash: string }) {
  const [hash = '/', q = ''] = full.split('?');
  const tourId = /^\/tour\/([\w-]+)/.exec(hash)?.[1];
  const known = useTours((s) => s.tours.some((x) => x.id === tourId));
  if (hash.startsWith('/t/')) return <SharedTour legacy={hash} />;
  if (hash.startsWith('/r/')) return <SharedTour stops={hash.slice(3)} query={q} />;
  // Someone else's route address (the address bar is a share link): the route to save.
  const foreign = tourId && !known && new URLSearchParams(q).get('s');
  if (foreign) return <SharedTour stops={foreign} query={q} />;
  if (hash.startsWith('/j/')) return <SharedTrip hash={hash} />;
  if (hash === '/trips') return <Trips />;
  // `now` and `replan` are older addresses of the same two screens.
  const tr = /^\/trip\/([\w-]+)(\/(map|now|edit|replan))?$/.exec(hash);
  if (tr?.[3] === 'edit' || tr?.[3] === 'replan') return <EditTrip id={tr[1]!} />;
  if (tr?.[3] === 'map')
    return (
      <Suspense fallback={null}>
        <MapView id={tr[1]!} trip />
      </Suspense>
    );
  if (tr) return <TripView id={tr[1]!} />;
  const m = /^\/tour\/([\w-]+)(\/(plan|templates|map))?$/.exec(hash);
  if (m?.[3] === 'plan') return <Timeline id={m[1]!} />;
  if (m?.[3] === 'map')
    return (
      <Suspense fallback={null}>
        <MapView id={m[1]!} />
      </Suspense>
    );
  if (m) return <Builder key={m[1]} id={m[1]!} showTemplates={m[3] === 'templates'} />;
  return <Home />;
}

export function App() {
  const lang = usePrefs((s) => s.lang);
  const load = useTours((s) => s.load);
  const loaded = useTours((s) => s.loaded);
  const loadTrips = useTrips((s) => s.load);
  const tripsLoaded = useTrips((s) => s.loaded);
  const hash = useHash();
  const opened = useRef(false);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    void load();
    void loadTrips();
  }, [load, loadTrips]);
  // Android: trip notifications follow the saved trips (scheduled anew on every change).
  const trips = useTrips((s) => s.trips);
  useEffect(() => {
    if (!tripsLoaded) return;
    const timer = setTimeout(() => void scheduleTrips(trips, lang).catch(() => undefined), 500);
    return () => clearTimeout(timer);
  }, [trips, tripsLoaded, lang]);
  useEffect(() => onNotificationTap((id) => (location.hash = `/trip/${id}`)), []);
  // Opening the app during a trip goes straight to "Now" (once, from the start screen).
  useEffect(() => {
    if (!tripsLoaded || opened.current) return;
    opened.current = true;
    if (location.hash && location.hash !== '#/') return;
    const live = liveTrip(useTrips.getState().trips, Date.now());
    if (live) location.hash = `/trip/${live.id}`;
  }, [tripsLoaded]);

  return (
    <>
      {loaded && tripsLoaded ? <Route hash={hash} /> : null}
      {!isNative && <UpdateBanner />}
    </>
  );
}
