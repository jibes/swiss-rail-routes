import { lazy, Suspense, useEffect, useRef } from 'react';
import { usePrefs, useT } from './store';
import { useTours } from './tours';
import { Home } from './ui/Home';
import { SharedTour } from './ui/SharedTour';
import { SharedTrip } from './ui/SharedTrip';
import { TripScreen } from './ui/TripScreen';
import { Settings } from './ui/Settings';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { watchBack } from './io/back';
import { log } from './io/log';
import { watchAutoPlan } from './io/autoplan';
import { useSync, watchSync } from './io/sync';
import { liveTrip } from './core/trip';
import { migratePastTrips } from './io/migratePast';
import { expectedArrival } from './core/live';
import { useLiveStatus } from './ui/useLive';
import { onNotificationTap, scheduleTrips } from './io/notifications';
import { isNative } from './native';
import { tripsLoaded as tripsRead, useTrips } from './trips';
import { UpdateBanner } from './ui/UpdateBanner';
import { useHash } from './ui/useHash';
import { NotFound } from './ui/NotFound';
import { useColumns } from './ui/useColumns';

/** Set once the app opened in this tab (srr.<name>.v<N>). */
const OPENED = 'srr.opened.v1';

const MapView = lazy(() => import('./ui/MapView'));

/**
 * One object (0.52.0): the routes kept as "your trips" before (a trip whose day was over left the
 * list) come back as trips, once, after the lists are read and sync has settled.
 */
function Migrate({ loaded, tripsLoaded }: { loaded: boolean; tripsLoaded: boolean }) {
  const settled = useSync((s) => s.settled);
  const tours = useTours((s) => s.tours);
  useEffect(() => {
    if (!loaded || !tripsLoaded || !settled || !tours.length) return;
    void migratePastTrips().catch(() => undefined);
  }, [loaded, tripsLoaded, settled, tours]);
  return null;
}

function Route({ hash: full }: { hash: string }) {
  const [hash = '/', q = ''] = full.split('?');
  if (hash.startsWith('/t/')) return <SharedTour legacy={hash} />;
  if (hash.startsWith('/r/')) return <SharedTour stops={hash.slice(3)} query={q} />;
  // A route's address from another device (0.3 and earlier): the route, to plan as a trip.
  const stops = /^\/tour\//.test(hash) && new URLSearchParams(q).get('s');
  if (stops) return <SharedTour stops={stops} query={q} />;
  if (hash.startsWith('/j/') || hash.startsWith('/s/')) return <SharedTrip hash={hash} />;
  if (hash === '/trips' || hash === '/') return <Home />;
  if (hash === '/settings') return <Settings />;
  if (hash.startsWith('/sync/')) return <Settings join={decodeURIComponent(hash.slice(6))} />;
  // `now` and `replan` are older addresses of the same screens.
  const tr = /^\/trip\/([\w-]+)(\/(map|now|edit|replan))?$/.exec(hash);
  // Changing the rest is for a trip under way; before, the trip screen edits it in place.
  // Older addresses of Replan from here: the trip, whose line edits what lies ahead (0.46.0).
  if (tr?.[3] === 'edit' || tr?.[3] === 'replan') return <TripScreen key={tr[1]} id={tr[1]!} />;
  if (tr?.[3] === 'map')
    return (
      <Suspense fallback={null}>
        <MapView id={tr[1]!} />
      </Suspense>
    );
  if (tr) return <TripScreen key={tr[1]} id={tr[1]!} />;
  return hash.startsWith('/tour/') ? <Home /> : <NotFound />;
}

/**
 * Desktop (0.61.0: two columns, no more): the list beside what it opens, a trip or its map. Each
 * column frames what a phone shows fixed (dock, sheets, notes), so every screen works in it
 * unchanged.
 */
function Columns({ hash }: { hash: string }) {
  const t = useT();
  const path = hash.split('?')[0]!;
  const home = path === '/' || path === '/trips';
  useEffect(() => {
    document.documentElement.classList.add('columns');
    return () => document.documentElement.classList.remove('columns');
  }, []);
  return (
    <div className="cols">
      <div
        className="col col-list"
        // Up and down the trips with the arrow keys; Enter opens one.
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          // Only cards shown: not those inside the past trips' fold while it is closed.
          const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('a.card')].filter(
            (c) => !c.closest('details:not([open])'),
          );
          const at = cards.indexOf(document.activeElement as HTMLElement);
          const next = cards[at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1)];
          if (!next) return;
          e.preventDefault();
          next.focus();
        }}
      >
        <div className="col-scroll">
          <Home />
        </div>
      </div>
      <div className="col col-main">
        <div className="col-scroll">
          {home ? (
            <p className="col-pick">{t('colsPick')}</p>
          ) : (
            <ErrorBoundary resetKey={path}>
              <Route hash={hash} />
            </ErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const lang = usePrefs((s) => s.lang);
  const load = useTours((s) => s.load);
  const loaded = useTours((s) => s.loaded);
  const loadTrips = useTrips((s) => s.load);
  const tripsLoaded = useTrips((s) => s.loaded);
  const hash = useHash();
  const columns = useColumns();
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
  useEffect(() => watchBack(), []);
  // Trips without a timetable (changed elsewhere, left before planning) are planned meanwhile.
  useEffect(() => (loaded && tripsLoaded ? watchAutoPlan() : undefined), [loaded, tripsLoaded]);
  // Sync once both lists are loaded; then on return to the app and after changes.
  useEffect(() => (loaded && tripsLoaded ? watchSync() : undefined), [loaded, tripsLoaded]);
  // Android smoke test (scripts/android-smoke.sh) waits for this line in the system log.
  useEffect(() => {
    if (!loaded || !tripsLoaded) return;
    console.info('srr:ready');
    log('app.ready', { trains: useLiveStatus.getState().status.size });
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
      <Migrate loaded={loaded} tripsLoaded={tripsLoaded} />
      {loaded && tripsLoaded ? (
        columns > 1 ? (
          <Columns hash={hash} />
        ) : (
          <ErrorBoundary resetKey={hash.split('?')[0]!}>
            <Route hash={hash} />
          </ErrorBoundary>
        )
      ) : null}
      {!isNative && <UpdateBanner />}
    </>
  );
}
