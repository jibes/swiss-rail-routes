// The device's location while `on`: watched only then (so the system asks only then), kept in
// memory only, and stopped when the map closes. Nothing here is stored, sent or logged but
// that it was turned on and why it failed.
import { useEffect, useState } from 'react';
import type { Fix } from '../core/position';
import { log } from '../io/log';

export const canLocate = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

export function useLocation(on: boolean, onDenied: () => void): Fix | null {
  const [fix, setFix] = useState<Fix | null>(null);
  useEffect(() => {
    if (!on || !canLocate()) return;
    log('location.on');
    const watch = navigator.geolocation.watchPosition(
      (p) =>
        setFix({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          // On the clock the map compares it with (the system's stamp may lag behind it).
          at: Date.now(),
        }),
      (e) => {
        log('location.error', { code: e.code });
        if (e.code === e.PERMISSION_DENIED) onDenied();
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    return () => {
      navigator.geolocation.clearWatch(watch);
      setFix(null);
    };
  }, [on, onDenied]);
  return fix;
}
