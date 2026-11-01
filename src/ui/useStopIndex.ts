import { useEffect, useState } from 'react';
import type { StopSearch } from '../core/stops';
import { stopSearch } from '../io/stops';

/** The bundled stop index once loaded (null until then). */
export function useStopIndex() {
  const [index, setIndex] = useState<StopSearch | null>(null);
  useEffect(() => {
    stopSearch().then(setIndex, () => undefined);
  }, []);
  return index;
}
