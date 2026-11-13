import { useId, useRef, useState } from 'react';
import { searchAttractions, type AttractionData } from '../core/attractions';
import { templateName, type RouteTemplate } from '../core/data';
import attractionData from '../data/attractions.json';
import { entriesOf, lineEntries, stationEntry, type Entry } from '../core/line';
import { pastRoutes } from '../core/pastTrips';
import { staysOnDay } from '../core/stay';
import type { Tour, Waypoint } from '../core/model';
import { fold, stopKey, type Stop } from '../core/stops';
import { usePrefs, useT } from '../store';
import { shortDate } from './format';
import { Icon } from './icons';
import { MiniLine } from './MiniLine';
import { RailLoader } from './RailLoader';
import { directionFrom, lineName, TEMPLATES } from './TemplatePicker';
import { autoName } from '../core/naming';
import { recentStations } from '../core/recentStops';
import { useRecentStops } from './recentStops';
import { useTrips } from '../trips';
import { useStopIndex } from './useStopIndex';
import { useNow } from './useNow';
import { dayOf } from '../core/trip';
import { useLayer } from './layers';
import { useModal } from './useModal';
import { euRef, placeName } from '../core/eu/plan';
import type { EuStop } from '../core/eu/request';
import { fetchEuStops } from '../io/ojp';

export type Picked =
  | { kind: 'station'; stop: Pick<Waypoint, 'stopRef' | 'name'> }
  /** A new trip from where the last one ends, on the day after (0.64.0). */
  | { kind: 'onward'; stop: Pick<Waypoint, 'stopRef' | 'name'>; date: string }
  | { kind: 'line'; template: RouteTemplate; reversed: boolean }
  | { kind: 'trip'; tour: Tour };

/**
 * The one way to add (SPEC §3a): a sheet that finds stations, scenic lines and your past trips.
 * `after` is the station it adds after (lines run on from there; none: a new trip), `next` the
 * one that follows it (a line ending there leads to it).
 */
export function AddSheet({
  title,
  after,
  next,
  first,
  onward,
  onPick,
  onClose,
}: {
  title: string;
  after?: Pick<Waypoint, 'stopRef' | 'name'>;
  next?: Pick<Waypoint, 'stopRef' | 'name'>;
  /** The trip's first station: offered as the way back (a round trip) when adding at the end. */
  first?: Pick<Waypoint, 'stopRef' | 'name'>;
  /** A new trip's start: where the last trip ends, the day after it, and that trip's name. */
  onward?: { stopRef: string; name: string; date: string; from: string };
  onPick: (p: Picked) => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const id = useId();
  const index = useStopIndex();
  const now = useNow();
  // Your past trips (0.52.0: the trips over, not a list of their own).
  const mine = pastRoutes(
    useTrips((x) => x.trips),
    now,
  );
  const [q, setQ] = useState('');
  // Stations abroad (0.33.0, Transitous): asked only on the tap, for the text as it was then.
  const [abroad, setAbroad] = useState<{ q: string; found: EuStop[] | 'asking' | 'failed' }>();
  const askAbroad = () => {
    const text = q.trim();
    setAbroad({ q: text, found: 'asking' });
    fetchEuStops(text).then(
      (found) =>
        setAbroad((a) =>
          a?.q === text
            ? { q: text, found: found.map((x) => ({ ...x, name: placeName(x.name, x) })) }
            : a,
        ),
      () => setAbroad((a) => (a?.q === text ? { q: text, found: 'failed' } : a)),
    );
  };
  const abroadNow = abroad?.q === q.trim() ? abroad.found : undefined;
  const input = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // Focus in, kept inside while Tab moves, and back when it closes.
  const trap = useModal(sheet, input);
  useLayer(true, onClose);

  const f = fold(q.trim());
  const stop = (r: string) => index?.byRef(stopKey(r));
  const fromAt = after ? stop(after.stopRef) : undefined;
  const from = fromAt && after ? { ...fromAt, ref: after.stopRef } : undefined;
  const nextAt = next ? { ref: next.stopRef, at: stop(next.stopRef) } : undefined;
  const has = (names: string[]) =>
    !f ||
    names.some(
      (n) =>
        fold(n)
          .split(' ')
          .some((w) => w.startsWith(f)) || fold(n).startsWith(f),
    );
  const trips = mine.filter(
    (x) => x.waypoints.length > 1 && has([x.name, ...x.waypoints.map((w) => w.name)]),
  );
  const stations: Stop[] = index && f.length >= 2 ? index.search(q, 8) : [];
  // Places (Swissminiatur, the Rhine Falls): their nearest stop, with the walk from it.
  const places =
    index && f.length >= 3
      ? searchAttractions(attractionData as AttractionData, q, lang, (r) => stop(r))
      : [];
  // By its name in any language, a named train on it ("Glacier Express", round 3) or a station.
  const named = (tp: (typeof TEMPLATES)[number]) => [tp.name, ...Object.values(tp.names ?? {})];
  const own = (tp: (typeof TEMPLATES)[number]) => [...named(tp), ...(tp.products ?? [])];
  // Lines named so first ("Bernina": the Bernina, then the Albula the Bernina Express rides).
  const lines = TEMPLATES.filter((tp) => has([...own(tp), ...tp.chain.map((c) => c.name)])).sort(
    (a, b) => Number(has(named(b))) - Number(has(named(a))),
  );
  // Typed a line's own name ("Bernina"): the line comes first, before stations named after it.
  // A station named just that ("Bern") stays first.
  const linesFirst =
    !!f && lines.some((tp) => has(own(tp))) && !stations.some((x) => fold(x.name) === f);
  const back = !f && first && after && after.stopRef !== first.stopRef ? first : undefined;
  const today = dayOf(now);
  // A past trip by its own name, else as the list names trips ("Zürich ↺ Tirano · Chur"), never
  // its two ends alone: a round trip was "Zürich → Zürich" (reported, 0.47.1).
  const titleOf = (x: Tour) =>
    (x.name && !/^(.+) → \1$/.test(x.name) ? x.name : '') ||
    autoName(x, (r) => index?.byRef(r), lineName);

  // Stations you entered lately, kept on this device (0.48.0): offered first.
  const picked = useRecentStops((x) => x.stops);
  const remember = useRecentStops((x) => x.add);
  const trips0 = useTrips((x) => x.trips);
  const pick = (p: Picked) => {
    if (p.kind === 'station' || p.kind === 'onward') remember([p.stop]);
    onPick(p);
  };
  const recent = f
    ? []
    : recentStations(
        picked,
        [
          ...[...trips0]
            .sort((a, b) => b.route.date.localeCompare(a.route.date))
            .map((x) => x.route.waypoints),
        ],
        [after?.stopRef, next?.stopRef].filter((x): x is string => !!x),
      );
  // Nothing typed: the stations first, lines and your trips folded under them.
  const folded = !f;

  const lineRows = lines.map((tp) => {
    const reversed = directionFrom(tp, from, stop, nextAt);
    const [a, b] = reversed ? [tp.chain.at(-1)!, tp.chain[0]!] : [tp.chain[0]!, tp.chain.at(-1)!];
    return (
      <button
        key={tp.id}
        type="button"
        className="result"
        onClick={() => pick({ kind: 'line', template: tp, reversed })}
      >
        <span className="r-icon r-line" aria-hidden="true" />
        <span className="r-name">{templateName(tp, lang)}</span>
        <span className="r-sub">
          {a.name} → {b.name}
        </span>
      </button>
    );
  });
  const tripRows = trips.map((x) => (
    <div key={x.id} className="result-row">
      <button type="button" className="result trip" onClick={() => pick({ kind: 'trip', tour: x })}>
        <span className="r-name">{titleOf(x)}</span>
        <MiniLine tour={x} />
        <span className="r-sub">
          {x.date < today
            ? t('wentOn', { date: shortDate(x.date, lang) })
            : t('stationsN', { n: x.waypoints.filter((w) => !w.ring).length })}
        </span>
      </button>
    </div>
  ));
  const lineList = lines.length > 0 && (
    <>
      <h3 className="section-label">{t('scenicLines')}</h3>
      {lineRows}
    </>
  );

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={sheet}
        className="sheet add-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        onKeyDown={trap}
      >
        <div className="grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={`${id}-h`}>{title}</h2>
          <button type="button" className="icon" aria-label={t('close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <label htmlFor={`${id}-q`} className="sr-only">
          {t('searchAdd')}
        </label>
        <input
          ref={input}
          id={`${id}-q`}
          className="search"
          value={q}
          autoComplete="off"
          placeholder={index ? t('searchAdd') : t('stopsLoading')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const tp = linesFirst ? lines[0] : undefined;
            if (tp)
              return pick({
                kind: 'line',
                template: tp,
                reversed: directionFrom(tp, from, stop, nextAt),
              });
            const s = stations[0] ?? places[0]?.stops[0];
            if (s) pick({ kind: 'station', stop: { stopRef: s.ref, name: s.name } });
          }}
        />
        <div className="results">
          {onward && !f && (
            <button
              type="button"
              className="result"
              onClick={() =>
                pick({
                  kind: 'onward',
                  stop: { stopRef: onward.stopRef, name: onward.name },
                  date: onward.date,
                })
              }
            >
              <span className="r-icon r-dot" aria-hidden="true" />
              <span className="r-name">{t('onwardFrom', { stop: onward.name })}</span>
              <span className="r-sub">
                {t('onwardAfter', {
                  trip: onward.from,
                  date: shortDate(onward.date, lang),
                })}
              </span>
            </button>
          )}
          {back && (
            <button
              type="button"
              className="result"
              onClick={() => pick({ kind: 'station', stop: back })}
            >
              <span className="r-icon r-dot" aria-hidden="true" />
              <span className="r-name">{t('backTo', { stop: back.name })}</span>
              <span className="r-sub">{t('roundTrip')}</span>
            </button>
          )}
          {linesFirst && lineList}
          {linesFirst && stations.length > 0 && (
            <h3 className="section-label">{t('stationsLabel')}</h3>
          )}
          {stations.map((s) => (
            <button
              key={s.ref}
              type="button"
              className="result"
              onClick={() => pick({ kind: 'station', stop: { stopRef: s.ref, name: s.name } })}
            >
              <span className={`r-icon r-dot ${kindOf(s) ? 'minor' : ''}`} aria-hidden="true" />
              <span className="r-name">{s.name}</span>
              {kindOf(s) && <span className="r-sub">{t(kindOf(s)!)}</span>}
            </button>
          ))}
          {places.length > 0 && <h3 className="section-label">{t('placesLabel')}</h3>}
          {places.map((p) => {
            const s = p.stops[0]!;
            return (
              <button
                key={p.id}
                type="button"
                className="result"
                onClick={() => pick({ kind: 'station', stop: { stopRef: s.ref, name: s.name } })}
              >
                <span className="r-icon r-dot minor" aria-hidden="true" />
                <span className="r-name">{p.name}</span>
                <span className="r-sub">
                  {t(s.estimate ? 'placeStop' : 'placeStopExact', { stop: s.name, n: s.walkMin })}
                </span>
              </button>
            );
          })}
          {f.length >= 3 && !abroadNow && (
            <button type="button" className="result" onClick={askAbroad}>
              <span className="r-icon" aria-hidden="true">
                <Icon name="globe" />
              </span>
              <span className="r-name">{t('searchAbroad', { q: q.trim() })}</span>
              <span className="r-sub">{t('abroadSource')}</span>
            </button>
          )}
          {abroadNow === 'asking' && <RailLoader label={t('abroadAsking')} />}
          {abroadNow === 'failed' && (
            <p className="muted" role="status">
              {t('abroadFailed')}{' '}
              <button type="button" className="text-button" onClick={askAbroad}>
                {t('retry')}
              </button>
            </p>
          )}
          {Array.isArray(abroadNow) && (
            <>
              <h3 className="section-label">{t('abroadLabel')}</h3>
              {!abroadNow.length && <p className="muted">{t('abroadNone')}</p>}
              {abroadNow.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="result"
                  onClick={() =>
                    pick({
                      kind: 'station',
                      stop: { stopRef: euRef(s.lat, s.lon, s.id), name: s.name },
                    })
                  }
                >
                  <span className="r-icon r-dot" aria-hidden="true" />
                  <span className="r-name">{s.name}</span>
                  <span className="r-sub">{s.country ?? t('abroadLabel')}</span>
                </button>
              ))}
            </>
          )}
          {!folded && trips.length > 0 && <h3 className="section-label">{t('pastTrips')}</h3>}
          {!folded && tripRows}
          {!folded && !linesFirst && lineList}
          {folded && recent.length > 0 && (
            <>
              <h3 className="section-label">{t('recentStations')}</h3>
              {recent.map((r) => (
                <button
                  key={r.stopRef}
                  type="button"
                  className="result recent"
                  onClick={() => pick({ kind: 'station', stop: r })}
                >
                  <span className="r-icon r-dot" aria-hidden="true" />
                  <span className="r-name">{r.name}</span>
                </button>
              ))}
            </>
          )}
          {folded && lines.length > 0 && (
            <details className="fold" open={(!recent.length && !trips.length) || undefined}>
              <summary>
                <h3 className="section-label">{t('scenicLines')}</h3>
                <span className="fold-n">{lines.length}</span>
              </summary>
              {lineRows}
            </details>
          )}
          {folded && trips.length > 0 && (
            <details className="fold" open={recent.length === 0 || undefined}>
              <summary>
                <h3 className="section-label">{t('pastTrips')}</h3>
                <span className="fold-n">{trips.length}</span>
              </summary>
              {tripRows}
            </details>
          )}

          {f.length >= 2 &&
            !stations.length &&
            !places.length &&
            !trips.length &&
            !lines.length &&
            (index ? (
              <p className="muted">{t('noStops')}</p>
            ) : (
              <RailLoader label={t('stopsLoading')} />
            ))}
        </div>
      </div>
    </div>
  );
}

/** Not a station trains call at: say what it is (a bus stop, a pier). */
function kindOf(s: Stop) {
  const m = s.modes;
  if (m.includes('TRAIN') || m.includes('RACK_RAILWAY') || m.includes('METRO')) return undefined;
  if (m.includes('BOAT')) return 'kindBoat' as const;
  if (m.some((x) => x === 'CABLE_CAR' || x === 'CABLE_RAILWAY' || x === 'CHAIRLIFT'))
    return 'kindCable' as const;
  if (m.includes('TRAM')) return 'kindTram' as const;
  if (m.includes('BUS')) return 'kindBus' as const;
  return undefined;
}

/**
 * What a pick adds to the line: a station, a scenic line's two ends, a past trip's stations (its
 * stays until a date and time moved to `day`, the trip's).
 */
export function entriesFor(p: Picked, day: string): Entry[] {
  if (p.kind === 'station' || p.kind === 'onward') return [stationEntry(p.stop)];
  if (p.kind === 'line') return lineEntries(p.template, p.reversed);
  return entriesOf({ waypoints: staysOnDay(p.tour.waypoints, p.tour.date, day) });
}
