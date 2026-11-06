// The line under way (TripLine with `live`): expected times with their delay, the stops of a
// ride, and the marker where you are between them.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LiveRide, LiveState } from '../core/live';
import type { LineRow, RideRow, StationRow } from '../core/rows';
import { useT } from '../store';
import { hhmm } from './format';

export interface LiveCtx {
  state: LiveState;
  now: number;
}

/** A time as expected, with "+N" when late. */
export function When({ plan, live }: { plan?: string; live?: number }) {
  const t = useT();
  if (!plan) return null;
  const planned = Date.parse(plan);
  const late = live !== undefined ? Math.round((live - planned) / 60_000) : 0;
  return (
    <time>
      {hhmm(live ?? planned)}
      {late > 0 && (
        <span className="late">
          {' '}
          <span aria-hidden="true">+{late}</span>
          <span className="sr-only">{t('lateBy', { n: late })}</span>
        </span>
      )}
    </time>
  );
}

export const rideOf = (live: LiveCtx | undefined, r: RideRow | undefined): LiveRide | undefined =>
  r && live?.state.rides.find((x) => x.leg === r.leg && x.section === r.sectionIndex);

export const isCurrent = (live: LiveCtx | undefined, r: RideRow) => {
  const c = live?.state.rides[live.state.current];
  return !!c && c.leg === r.leg && c.section === r.sectionIndex;
};

/** A station's expected times, and whether it is behind you or where you wait now. */
export function stationLive(rows: LineRow[], i: number, live: LiveCtx | undefined) {
  if (!live) return undefined;
  const r = rows[i] as StationRow;
  let before: RideRow | undefined;
  for (let j = i - 1; j >= 0; j--) {
    const x = rows[j]!;
    if (x.type === 'ride') {
      before = x;
      break;
    }
  }
  const next = rows[i + 1];
  const after = next?.type === 'ride' && next.section.mode !== 'walk' ? next : undefined;
  const inRide = rideOf(live, before);
  const keys = [r.key, ...(r.also ?? [])];
  const arrStop =
    inRide?.stops.find((s, k) => k > 0 && keys.includes(s.key)) ??
    (before && rows[i - 1] === before ? inRide?.stops.at(-1) : undefined);
  const depStop = rideOf(live, after)?.stops[0];
  const waiting = !!after && isCurrent(live, after) && live.state.phase !== 'riding';
  const at = depStop?.dep ?? arrStop?.arr ?? Date.parse(r.dep ?? r.arr ?? '');
  return {
    arr: arrStop?.arr,
    dep: depStop?.dep ?? (arrStop && !after ? undefined : arrStop?.dep),
    platform: depStop?.platform,
    here: waiting,
    passed: !waiting && at <= live.now,
  };
}

/**
 * With a ride's stops open, puts the marker (and the grey/red split of the rail) where the train
 * is between the two stops shown, measured from the laid-out list (`--fm`; without it the CSS
 * falls back to `--f`, the share of the whole ride).
 */
export function SyncHere({ i, fraction }: { i: number; fraction: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = ref.current?.closest<HTMLElement>('li.ride');
    const rail = row?.querySelector<HTMLElement>(':scope > .rail');
    if (!row || !rail) return;
    const place = () => {
      const top = rail.getBoundingClientRect().top;
      const mids = [...row.querySelectorAll<HTMLElement>('.mids > li:not(.here-mid)')];
      // Points along the rail: the departure (row top), each stop between, the arrival (row end).
      const points = [
        0,
        ...mids.map((li) => {
          const b = li.getBoundingClientRect();
          return b.top + b.height / 2 - top;
        }),
        rail.getBoundingClientRect().height,
      ];
      const a = points[Math.min(i, points.length - 1)]!;
      const b = points[Math.min(i + 1, points.length - 1)]!;
      row.style.setProperty('--fm', `${(a + (b - a) * fraction).toFixed(1)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(row);
    return () => {
      ro.disconnect();
      row.style.removeProperty('--fm');
    };
  }, [i, fraction]);
  return <span ref={ref} hidden />;
}

/**
 * A ride's stops between its ends, with the marker where you are: all of them, or (`all` false)
 * only the route's own, which `via` draws (it answers nothing for any other stop).
 */
export function Mids({
  r,
  live,
  riding,
  all,
  via,
  pin,
}: {
  r: RideRow;
  live: LiveCtx | undefined;
  riding: boolean;
  all: boolean;
  via: (call: number, when: ReactNode, passed: boolean) => ReactNode;
  /** Editable: a stop's name opens what can be done with it (made yours). */
  pin?: {
    open: (call: number) => boolean;
    toggle: (call: number) => void;
    menu: (call: number) => ReactNode;
  };
}) {
  const t = useT();
  const lr = rideOf(live, r);
  const mids = r.section.intermediate;
  const between = riding && all ? live?.state.between : undefined;
  const here = (
    <li key="here" className="here-mid">
      <span className="sr-only">{t('youAreHere')}</span>
      {between && <SyncHere i={between.i} fraction={between.fraction} />}
    </li>
  );
  return (
    <ol className="mids">
      {mids.flatMap((m, k) => {
        const ls = lr?.stops[k + 1];
        const when = ls?.dep ?? ls?.arr;
        const passed = !!live && when !== undefined && when <= live.now;
        const time = <When plan={m.dep ?? m.arr} live={when} />;
        const own = via(k, time, passed);
        if (!own && !all) return [];
        const item = own ?? (
          <li key={k} className={passed ? 'passed' : ''}>
            {time}
            {pin ? (
              <button
                type="button"
                className="mid-name"
                aria-expanded={pin.open(k)}
                onClick={() => pin.toggle(k)}
              >
                {m.name}
              </button>
            ) : (
              <span>{m.name}</span>
            )}
            {pin?.open(k) && pin.menu(k)}
          </li>
        );
        // Between stops[j] and stops[j+1]: the marker goes just before stop j (mids[k = j]).
        return between?.i === k ? [here, item] : [item];
      })}
      {between?.i === mids.length && here}
    </ol>
  );
}
