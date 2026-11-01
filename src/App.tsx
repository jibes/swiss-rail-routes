import { useEffect } from 'react';
import { usePrefs } from './store';
import { Home } from './ui/Home';
import { UpdateBanner } from './ui/UpdateBanner';

export function App() {
  const lang = usePrefs((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <>
      <Home />
      <UpdateBanner />
    </>
  );
}
