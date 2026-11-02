import { lazy, Suspense, useEffect, useRef } from 'react';
import { usePrefs } from './store';
import { useTours } from './tours';
import { Home } from './ui/Home';
import { SharedTour } from './ui/SharedTour';
import { SharedTrip } from './ui/SharedTrip';
import { TripScreen } from './ui/TripScreen';
import { EditTrip } from './ui/EditTrip';
import { Settings } from './ui/Settings';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { watchBack } from './io/back';
import { watchSync } from './io/sync';
import { liveTrip } from './core/trip';
import { retire } from './core/retire';
import { expectedArrival } from './core/live';
import { useLiveStatus } from './ui/useLive';
import { onNotificationTap, scheduleTrips } from './io/notifications';
import { isNative } from './native';
import { useTrips } from './trips';
import { UpdateBanner } from './ui/UpdateBanner';
import { useHash } from './ui/useHash';
import { useNow } from './ui/useNow';
import { NotFound } from './ui/NotFound';

/** Set once the app opened in this tab (srr.<name>.v<N>). */
const OPENED = 'srr.opened.v1';

const MapView = lazy(() => import('./ui/MapView'));

function Route({ hash: full }: { hash: string }) {
  const [hash = '/', q = ''] = full.split('?');
  if (hash.startsWith('/t/')) return <SharedTour legacy={hash} />;
  if (hash.startsWith('/r/')) return <SharedTour stops={hash.slice(3)} query={q} />;
  // A route's address from another device (0.3 and earlier): the route, to plan as a trip.
  const stops = /^\/tour\//.test(hash) && new URLSearchParams(q).get('s');
  if (stops) return <SharedTour stops={stops} query={q} />;
  if (hash.startsWith('/j/')) return <SharedTrip hash={hash} />;
  if (hash === '/trips' || hash === '/') return <Home />;
  if (hash === '/settings') return <Settings />;
  if (hash.startsWith('/sync/')) return <Settings join={decodeURIComponent(hash.slice(6))} />;
  // `now` and `replan` are older addresses of the same screens.
  const tr = /^\/trip\/([\w-]+)(\/(map|now|edit|replan))?$/.exec(hash);
  if (tr?.[3] === 'edit' || tr?.[3] === 'replan') return <EditTrip id={tr[1]!} />;
  if (tr?.[3] === 'map')
    return (
      <Suspense fallback={null}>
        <MapView id={tr[1]!} trip />
      </Suspense>
    );
  if (tr) return <TripScreen key={tr[1]} id={tr[1]!} />;
  return hash.startsWith('/tour/') ? <Home /> : <NotFound />;
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
  // A trip whose day is over leaves the list and waits in search (your trips), checked as the
  // clock moves on.
  const now = useNow();
  useEffect(() => {
    if (!loaded || !tripsLoaded) return;
    const live = useLiveStatus.getState().status;
    const r = retire(useTrips.getState().trips, useTours.getState().tours, now, (t) =>
      t.chain ? expectedArrival(t.chain.connections, live) : undefined,
    );
    if (!r.changed) return;
    void useTours.getState().replaceAll(r.tours);
    void useTrips.getState().replaceAll(r.trips);
  }, [loaded, tripsLoaded, now]);
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
    const status = useLiveStatus.getState().status;
    const live = liveTrip(useTrips.getState().trips, Date.now(), (t) =>
      t.chain ? expectedArrival(t.chain.connections, status) : undefined,
    );
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
