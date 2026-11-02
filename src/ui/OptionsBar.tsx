import { useEffect, useRef, useState } from 'react';
import { optionsKey } from '../core/answers';
import type { Leg } from '../core/model';
import type { PlanResult, PlannedChain } from '../core/planner/plan';
import { dayOf, type Trip } from '../core/trip';
import { log } from '../io/log';
import { planRoute } from '../io/planTrip';
import { loadOptions, saveOptions } from '../io/tours';
import { useTrips } from '../trips';
import { useT } from '../store';
import { duration, hhmm, minutesBetween, zurichHm } from './format';
import { Icon } from './icons';
import { RailLoader } from './RailLoader';

interface Option {
  c: PlannedChain;
  legs: Leg[];
}

const keyOf = (c: PlannedChain) => `${c.dep}|${c.arr}`;

/**
 * The connections found for the trip, as one strip (0.5.7). The arrows load more, earlier or
 * later, into the strip, and the nearest one loaded becomes the trip (0.8.3), so the line shows
 * it at once; a tap goes back to any other. The timetable service answers leg by leg, so "more"
 * means planning again from just before the first or after the last.
 */
export function OptionsBar({
  trip,
  result,
  planning,
  failed: planFailed = false,
  choose,
  from,
  move,
}: {
  trip: Trip;
  /** The screen's own plan (its options, the recommended one). */
  result: PlanResult | null;
  planning: boolean;
  /** Planning failed (offline, the service): the screen says so; the strip says nothing. */
  failed?: boolean;
  choose: (c: PlannedChain, legs: Leg[]) => void;
  /** The time searched from, and moving it (when nothing was found, the arrows do that). */
  from: string;
  move: (min: number) => void;
}) {
  const t = useT();
  // The route without its name or time: options of one route, whatever time they were asked from.
  const base = optionsKey(trip.route);
  // Options loaded with the arrows, for this route and day; kept while you choose among them,
  // and on the device until they have left (`srr.options.v1`), so opening the trip again shows
  // them without asking.
  const [more, setMoreNow] = useState<{ base: string; list: Option[] }>({ base, list: [] });
  const setMore = (m: { base: string; list: Option[] }) => {
    setMoreNow(m);
    void saveOptions(
      trip.id,
      { key: m.base, list: m.list },
      new Set(useTrips.getState().trips.map((x) => x.id)),
    );
  };
  useEffect(() => {
    let on = true;
    void loadOptions(trip.id, base).then((list) => {
      if (on && list.length)
        setMoreNow((m) => (m.base === base && m.list.length ? m : { base, list }));
    });
    return () => {
      on = false;
    };
  }, [trip.id, base]);
  const [busy, setBusy] = useState<'earlier' | 'later' | null>(null);
  const [none, setNone] = useState<{
    base: string;
    dir: 'earlier' | 'later';
    failed?: boolean;
  } | null>(null);
  const own: Option[] =
    result?.options && result.legs ? result.options.map((c) => ({ c, legs: result.legs! })) : [];
  const extra = more.base === base ? more.list : [];
  const chosen = trip.chain && trip.legs ? [{ c: trip.chain, legs: trip.legs }] : [];
  const all = [...new Map([...extra, ...own, ...chosen].map((o) => [keyOf(o.c), o])).values()].sort(
    (a, b) => Date.parse(a.c.dep) - Date.parse(b.c.dep),
  );
  const sameArr = all.length > 1 && all.every((o) => o.c.arr === all[0]!.c.arr);
  const noMore = none?.base === base && !none.failed ? none.dir : null;
  const failed = none?.base === base && none.failed;
  const strip = useRef<HTMLDivElement>(null);
  /** The route as it is now, for an answer that comes after an edit. */
  const current = useRef(base);
  useEffect(() => {
    current.current = base;
  }, [base]);
  const chosenKey = trip.chain ? keyOf(trip.chain) : '';
  // The chosen one in view, also after more were loaded around it. Only the strip scrolls
  // (scrollIntoView would move the page too).
  useEffect(() => {
    const box = strip.current;
    const el = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (box && el) box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
  }, [chosenKey, all.length]);
  // What is loading, in view: the strip scrolls to the end being filled.
  useEffect(() => {
    const box = strip.current;
    if (busy && box) box.scrollLeft = busy === 'later' ? box.scrollWidth : 0;
  }, [busy]);

  const load = async (dir: 'earlier' | 'later') => {
    const first = all[0];
    const last = all.at(-1);
    if (!first || !last) return;
    // Later: from just after the last option. Earlier: two hours before the first (the planner
    // finds connections leaving at or after the time it is given).
    const at =
      dir === 'later' ? Date.parse(last.c.dep) + 60_000 : Date.parse(first.c.dep) - 120 * 60_000;
    log('options.more', { trip: trip.id, dir, from: zurichHm(at), shown: all.length });
    if (dayOf(at) !== trip.route.date) {
      log('options.more.otherDay', { trip: trip.id, dir });
      return setNone({ base, dir });
    }
    setBusy(dir);
    setNone(null);
    try {
      const r = await planRoute(
        { ...trip, route: { ...trip.route, anchor: { departAt: zurichHm(at) } } },
        undefined,
        false,
      );
      const found = (r.options ?? []).filter(
        (c) =>
          !all.some((o) => keyOf(o.c) === keyOf(c)) && dayOf(Date.parse(c.dep)) === trip.route.date,
      );
      const fresh =
        dir === 'later'
          ? found.filter((c) => Date.parse(c.dep) > Date.parse(last.c.dep))
          : found.filter((c) => Date.parse(c.dep) < Date.parse(first.c.dep));
      fresh.sort((a, b) => Date.parse(a.dep) - Date.parse(b.dep));
      log('options.more.done', {
        trip: trip.id,
        dir,
        found: found.length,
        fresh: fresh.map((c) => `${hhmm(c.dep)}-${hhmm(c.arr)}`),
      });
      if (!fresh.length || !r.legs) setNone({ base, dir });
      else {
        const loaded = fresh.map((c) => ({ c, legs: r.legs! }));
        // The route changed while they came: they are another route's.
        if (current.current !== base) return;
        // Kept with the route, then the one next to where you were becomes the trip.
        setMore({ base, list: [...all, ...loaded] });
        const next = dir === 'later' ? loaded[0]! : loaded.at(-1)!;
        log('options.more.choose', { trip: trip.id, dep: next.c.dep, arr: next.c.arr });
        choose(next.c, next.legs);
      }
    } catch (e) {
      log('options.more.fail', { trip: trip.id, dir, e });
      // Not none: the service did not answer (offline, busy). Say so; the arrow stays usable.
      setNone({ base, dir, failed: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="options-wrap">
      <div className="options-bar">
        {/* The arrows scroll with the options: more earlier before the first, more later
            after the last. */}
        <div className="opts" ref={strip}>
          <button
            type="button"
            className="shift"
            aria-label={t('earlierOptions')}
            aria-busy={busy === 'earlier'}
            disabled={
              planning || busy !== null || noMore === 'earlier' || (!all.length && planFailed)
            }
            onClick={() => (all.length ? void load('earlier') : move(-60))}
          >
            <Icon name="back" size={18} />
          </button>
          <div className="opts-list" role="group" aria-label={t('alternatives')}>
            {busy === 'earlier' && (
              <span className="opt loading">
                <RailLoader label={t('loadingMore')} small />
              </span>
            )}
            {all.map(({ c, legs }) => {
              const on = trip.chain?.dep === c.dep && trip.chain.arr === c.arr;
              return (
                <button
                  key={keyOf(c)}
                  type="button"
                  className={`opt ${planning ? 'stale' : ''}`}
                  aria-pressed={on && !planning}
                  disabled={planning}
                  onClick={() => {
                    // What is shown stays: the options loaded so far are kept with this route.
                    setMore({ base, list: all });
                    choose(c, legs);
                  }}
                >
                  <b>
                    {hhmm(c.dep)}
                    {c.dep === result?.recommended?.dep && c.arr === result.recommended.arr && (
                      <span className="best" role="img" aria-label={t('recommended')} />
                    )}
                  </b>
                  <span>
                    {sameArr
                      ? duration(minutesBetween(c.dep, c.arr))
                      : t('backAt', { time: hhmm(c.arr) })}
                  </span>
                </button>
              );
            })}
            {busy === 'later' && (
              <span className="opt loading">
                <RailLoader label={t('loadingMore')} small />
              </span>
            )}
            {!all.length && !planFailed && (
              <span className="single muted">
                {/* The screen announces planning once; this loader is only seen. */}
                {planning ? <RailLoader small /> : t('noneFrom', { time: from })}
              </span>
            )}
          </div>
          <button
            type="button"
            className="shift"
            aria-label={t('laterOptions')}
            aria-busy={busy === 'later'}
            disabled={
              planning || busy !== null || noMore === 'later' || (!all.length && planFailed)
            }
            onClick={() => (all.length ? void load('later') : move(60))}
          >
            <Icon name="next" size={18} />
          </button>
        </div>
      </div>
      {(noMore || failed) && (
        <p className="muted options-note" role="status">
          {failed ? t('moreFailed') : noMore === 'later' ? t('noLater') : t('noEarlier')}
        </p>
      )}
    </div>
  );
}
