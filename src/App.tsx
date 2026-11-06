import { lazy, Suspense, useEffect, useRef } from 'react';
import { usePrefs, useT } from './store';
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
import { useColumns } from './ui/useColumns';
import { useFocusStop } from './ui/focusStop';

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

/**
 * A trip whose day is over leaves the list and waits in search (your trips), checked as the clock
 * moves on. Its own component: the shared 15 s clock re-renders only it, not the whole app.
 */
function Retire({ loaded, tripsLoaded }: { loaded: boolean; tripsLoaded: boolean }) {
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

/**
 * Desktop: the list, the trip and its map side by side (3 columns), or the trip and its map (2).
 * The trip's own map address shows the trip beside it. Each column frames what a phone shows
 * fixed (dock, sheets, notes), so every screen works in it unchanged.
 */
function Columns({ hash, n }: { hash: string; n: 2 | 3 }) {
  const t = useT();
  const path = hash.split('?')[0]!;
  const id = /^\/trip\/([\w-]+)/.exec(path)?.[1];
  const main = id && /\/map$/.test(path) ? `/trip/${id}` : hash;
  const home = path === '/' || path === '/trips';
  const setFocus = useFocusStop((s) => s.set);
  useEffect(() => {
    document.documentElement.classList.add('columns');
    return () => document.documentElement.classList.remove('columns');
  }, []);
  return (
    <div className={`cols cols-${n}`}>
      {n === 3 && (
        <div
          className="col col-list"
          // Up and down the trips with the arrow keys; Enter opens one.
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('a.card')];
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
      )}
      <div
        className="col col-main"
        // The station under the pointer, ringed on the map beside it.
        onMouseOver={(e) =>
          setFocus(
            (e.target as Element).closest?.('[data-stop]')?.getAttribute('data-stop') ?? null,
          )
        }
        onMouseLeave={() => setFocus(null)}
      >
        <div className="col-scroll">
          {n === 3 && home ? (
            <p className="col-pick">{t('colsPick')}</p>
          ) : (
            <ErrorBoundary resetKey={main.split('?')[0]!}>
              <Route hash={main} />
            </ErrorBoundary>
          )}
        </div>
      </div>
      {n === 3 || id ? (
        <div className="col col-map">
          {id && (
            <Suspense fallback={null}>
              <MapView key={id} id={id} />
            </Suspense>
          )}
        </div>
      ) : null}
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
      <Retire loaded={loaded} tripsLoaded={tripsLoaded} />
      {loaded && tripsLoaded ? (
        columns > 1 ? (
          <Columns hash={hash} n={columns as 2 | 3} />
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
