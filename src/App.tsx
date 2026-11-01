import { lazy, Suspense, useEffect } from 'react';
import { usePrefs } from './store';
import { useTours } from './tours';
import { Builder } from './ui/Builder';
import { Home } from './ui/Home';
import { SharedTour } from './ui/SharedTour';
import { Timeline } from './ui/Timeline';
import { UpdateBanner } from './ui/UpdateBanner';
import { useHash } from './ui/useHash';

const MapView = lazy(() => import('./ui/MapView'));

function Route({ hash }: { hash: string }) {
  if (hash.startsWith('/t/')) return <SharedTour hash={hash} />;
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
  const hash = useHash();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {loaded ? <Route hash={hash} /> : null}
      <UpdateBanner />
    </>
  );
}
