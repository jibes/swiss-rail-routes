import { lazy, Suspense, useEffect, useRef } from 'react';
import { usePrefs } from './store';
import { useTours } from './tours';
import { Builder } from './ui/Builder';
import { Home } from './ui/Home';
import { SharedTour } from './ui/SharedTour';
import { SharedTrip } from './ui/SharedTrip';
import { Timeline } from './ui/Timeline';
import { TripView } from './ui/TripView';
import { EditTrip } from './ui/EditTrip';
import { Settings } from './ui/Settings';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { watchSync } from './io/sync';
import { watchBack } from './io/back';
import { liveTrip } from './core/trip';
import { onNotificationTap, scheduleTrips } from './io/notifications';
import { isNative } from './native';
import { useTrips } from './trips';
import { UpdateBanner } from './ui/UpdateBanner';
import { useHash } from './ui/useHash';

/** Set once the app opened in this tab (srr.<name>.v<N>). */
const OPENED = 'srr.opened.v1';
/** Set once routes covered by a trip were folded into it (one list, 0.3.0). */
const ONE_LIST = 'srr.oneList.v1';

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
  // One list now (Ideas and Trips together); the old Trips tab's address opens it.
  if (hash === '/trips') return <Home />;
  if (hash === '/settings') return <Settings />;
  if (hash.startsWith('/sync/')) return <Settings join={decodeURIComponent(hash.slice(6))} />;
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
    const timer = setTimeout(() => void scheduleTrips(trips, lang), 500);
    return () => clearTimeout(timer);
  }, [trips, tripsLoaded, lang]);
  // One list (0.3.0): a route that a saved trip was planned from, unchanged since, was the same
  // thing twice; the trip stays, the route goes. Once per device; other routes stay as ideas.
  useEffect(() => {
    if (!loaded || !tripsLoaded) return;
    try {
      if (localStorage.getItem(ONE_LIST)) return;
      localStorage.setItem(ONE_LIST, '1');
    } catch {
      return;
    }
    const trips = useTrips.getState().trips;
    for (const idea of useTours.getState().tours)
      if (
        trips.some(
          (x) =>
            x.routeId === idea.id &&
            JSON.stringify(x.route.waypoints) === JSON.stringify(idea.waypoints),
        )
      )
        useTours.getState().remove(idea.id);
  }, [loaded, tripsLoaded]);
  useEffect(() => watchBack(), []);
  // Sync once both lists are loaded; then on return to the app and after changes.
  useEffect(() => (loaded && tripsLoaded ? watchSync() : undefined), [loaded, tripsLoaded]);
  // Android smoke test (scripts/android-smoke.sh) waits for this line in the system log.
  useEffect(() => {
    if (loaded && tripsLoaded) console.info('srr:ready');
  }, [loaded, tripsLoaded]);
  useEffect(() => onNotificationTap((id) => (location.hash = `/trip/${id}`)), []);
  // Opening the app during a trip goes straight to it (once, from the start screen). A reload
  // stays where it was: it is not an opening.
  useEffect(() => {
    if (!tripsLoaded || opened.current) return;
    opened.current = true;
    if (location.hash && location.hash !== '#/') return;
    // Once per tab (or app start): sessionStorage outlives a reload, not a closed tab.
    try {
      if (sessionStorage.getItem(OPENED)) return;
      sessionStorage.setItem(OPENED, '1');
    } catch {
      // No session storage (some private modes): go to the trip as on any opening.
    }
    const live = liveTrip(useTrips.getState().trips, Date.now());
    if (live) location.hash = `/trip/${live.id}`;
  }, [tripsLoaded]);

  return (
    <>
      {loaded && tripsLoaded ? (
        <ErrorBoundary resetKey={hash.split('?')[0]!}>
          <Route hash={hash} />
        </ErrorBoundary>
      ) : null}
      {!isNative && <UpdateBanner />}
    </>
  );
}
