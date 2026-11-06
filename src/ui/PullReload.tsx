import { useCallback, useEffect, useRef, useState } from 'react';
import type { Refreshed } from '../core/refresh';
import { useT } from '../store';
import { RailLoader } from './RailLoader';

/** How far the finger travels (px) before letting go reloads; the mark moves half of that. */
const PULL = 120;

export type ReloadSaid = 'reloadDone' | 'reloadFailed' | 'reloadOld' | null;

/** What a reload's outcome means for the person who asked. */
export function saidOf(r: Refreshed, past: boolean): ReloadSaid {
  if (r.found === 0 && r.gone === 0) return r.rides ? 'reloadFailed' : 'reloadDone';
  if (past && r.found === 0) return 'reloadOld';
  return r.failed ? 'reloadFailed' : 'reloadDone';
}

/** Runs one reload at a time, and says how it went for a few seconds. */
export function useReload(run: () => Promise<ReloadSaid>) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<ReloadSaid>(null);
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const going = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reload = useCallback(async () => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setSaid(null);
    const out = await latest.current().catch((): ReloadSaid => 'reloadFailed');
    going.current = false;
    setBusy(false);
    setSaid(out);
    timer.current = setTimeout(() => setSaid(null), 5000);
  }, []);
  return { busy, said, reload };
}

/**
 * Pull the page down from its top to reload, with its mark and what happened. The same is in
 * the screen's menu or a button, for those without touch. Not from what has its own gesture
 * (a station's grip), nor over what lies on top (a sheet, the menu).
 */
export function PullReload({
  busy,
  said,
  reload,
}: {
  busy: boolean;
  said: ReloadSaid;
  reload: () => void;
}) {
  const t = useT();
  const [pull, setPull] = useState(0);
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let travel = 0;
    const down = (e: TouchEvent) => {
      const el = e.target as Element;
      start =
        e.touches.length === 1 &&
        window.scrollY <= 0 &&
        // Not over what lies on top: a sheet, the menu, the map planner (its map pans by finger).
        !document.querySelector('.menu-scrim, .scrim, dialog[open], .maplibregl-canvas.adding') &&
        !el.closest?.('input, textarea, select') &&
        getComputedStyle(el).touchAction !== 'none'
          ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
          : null;
      travel = 0;
    };
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const dx = e.touches[0]!.clientX - start.x;
      const dy = e.touches[0]!.clientY - start.y;
      if (!dx && !dy) return; // Not moved yet.
      // Sideways first (the options strip) or up: not a pull.
      if (window.scrollY > 0 || (travel === 0 && (dy <= 0 || Math.abs(dx) > dy))) {
        start = null;
        setPull(0);
        return;
      }
      travel = Math.max(0, dy);
      setPull(Math.min(travel, PULL * 1.3));
    };
    const up = () => {
      if (start && travel >= PULL) reload();
      start = null;
      travel = 0;
      setPull(0);
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', up, { passive: true });
    // The browser's own pull would reload the whole page instead.
    document.documentElement.classList.add('pull-reload');
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', up);
      document.documentElement.classList.remove('pull-reload');
    };
  }, [reload]);
  return (
    <>
      {(pull > 0 || busy) && (
        <div
          className="pull-mark"
          style={
            busy ? undefined : { transform: `translateY(${pull / 2 - 40}px)`, opacity: pull / PULL }
          }
        >
          {busy ? (
            <RailLoader label={t('reloading')} />
          ) : (
            t(pull >= PULL ? 'reloadRelease' : 'reloadPull')
          )}
        </div>
      )}
      <p className="sr-only" role="status">
        {busy ? t('reloading') : said ? t(said) : ''}
      </p>
      {said && !busy && (
        <p className={`pull-said ${said === 'reloadDone' ? '' : 'bad'}`} aria-hidden="true">
          {t(said)}
        </p>
      )}
    </>
  );
}
