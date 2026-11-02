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
import { log } from './io/log';
import { watchAutoPlan } from './io/autoplan';
import { useSync, watchSync } from './io/sync';
import { liveTrip, tripStatus } from './core/trip';
import { retire } from './core/retire';
import { expectedArrival } from './core/live';
import { useLiveStatus } from './ui/useLive';
import { onNotificationTap, scheduleTrips } from './io/notifications';
import { isNative } from './native';
import { tripsLoaded as tripsRead, useTrips } from './trips';
import { UpdateBanner } from './ui/UpdateBanner';
import { useHash } from './ui/useHash';
import { useNow } from './ui/useNow';
import { NotFound } from './ui/NotFound';

/** Set once the app opened in this tab (srr.<name>.v<N>). */
const OPENED = 'srr.opened.v1';

const MapView = lazy(() => import('./ui/MapView'));

/** `#/trip/<id>/edit`: Replan from here while the trip is under way, else the trip itself. */
function EditOrTrip({ id }: { id: string }) {
  const now = useNow();
  const status = useLiveStatus((s) => s.status);
  const live = useTrips((s) => {
    const t = s.trips.find((x) => x.id === id);
    return (
      !!t &&
      tripStatus(t, now, t.chain ? expectedArrival(t.chain.connections, status) : undefined) ===
        'live'
    );
  });
  return live ? <EditTrip id={id} /> : <TripScreen key={id} id={id} />;
}

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
  // Changing the rest is for a trip under way; before, the trip screen edits it in place.
  if (tr?.[3] === 'edit' || tr?.[3] === 'replan') return <EditOrTrip id={tr[1]!} />;
  if (tr?.[3] === 'map')
    return (
      <Suspense fallback={null}>
        <MapView id={tr[1]!} />
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
    // Back in the app: notifications may have been allowed in the system settings meanwhile.
    const back = () =>
      document.visibilityState === 'visible' && void scheduleTrips(useTrips.getState().trips, lang);
    document.addEventListener('visibilitychange', back);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, [trips, tripsLoaded, lang]);
  // A trip whose day is over leaves the list and waits in search (your trips), checked as the
  // clock moves on.
  const now = useNow();
  const settled = useSync((s) => s.settled);
  useEffect(() => {
    if (!loaded || !tripsLoaded || !settled) return;
    // Lists that could not be read are never written.
    if (useTrips.getState().failed || useTours.getState().failed) return;
    const live = useLiveStatus.getState().status;
    const r = retire(useTrips.getState().trips, useTours.getState().tours, now, (t) =>
      t.chain ? expectedArrival(t.chain.connections, live) : undefined,
    );
    if (!r.changed) return;
    log('retire', {
      trips: useTrips.getState().trips.length - r.trips.length,
      pastTrips: r.tours.length - useTours.getState().tours.length,
    });
    void useTours
      .getState()
      .replaceAll(r.tours)
      .catch(() => undefined);
    void useTrips
      .getState()
      .replaceAll(r.trips)
      .catch(() => undefined);
  }, [loaded, tripsLoaded, settled, now]);
  useEffect(() => watchBack(), []);
  // Trips without a timetable (changed elsewhere, left before planning) are planned meanwhile.
  useEffect(() => (loaded && tripsLoaded ? watchAutoPlan() : undefined), [loaded, tripsLoaded]);
  // Sync once both lists are loaded; then on return to the app and after changes.
  useEffect(() => (loaded && tripsLoaded ? watchSync() : undefined), [loaded, tripsLoaded]);
  // Android smoke test (scripts/android-smoke.sh) waits for this line in the system log.
  useEffect(() => {
    if (!loaded || !tripsLoaded) return;
    console.info('srr:ready');
    log('app.ready', { live: !!useLiveStatus.getState().status });
  }, [loaded, tripsLoaded]);
  // A notification of a trip deleted or retired since opens the list instead.
  useEffect(
    () =>
      onNotificationTap((id) => {
        // On a cold start the tap comes before the trips are read: wait for them.
        void tripsRead().then(() => {
          location.hash = useTrips.getState().trips.some((t) => t.id === id) ? `/trip/${id}` : '/';
        });
      }),
    [],
  );
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
