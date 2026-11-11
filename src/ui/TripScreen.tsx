import { useCallback, useEffect, useRef, useState } from 'react';
import { expectedArrival } from '../core/live';
import {
  DEFAULT_STAY,
  dropLine,
  entriesOf,
  insertEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  reverseRoute,
  setEntryStayUntil,
  setEntryStay,
  sameWayBack,
  stationEntry,
} from '../core/line';
import type { Tour } from '../core/model';
import { autoName } from '../core/naming';
import { plannedRows, routeRows, type LineRow } from '../core/rows';
import { stopKey } from '../core/stops';
import { compactTrip, dayOf, isPlanned, newTrip, isLive } from '../core/trip';
import { acceptDate, acceptTime, earliestDay, timeOnDate } from '../core/when';
import { usePrefs, useT } from '../store';
import { lineName } from './TemplatePicker';
import { useTrips } from '../trips';
import { AddSheet, entriesFor, type Picked } from './AddSheet';
import { downloadIcs, ShareButton } from './ExportSheet';
import { reloadTrip, shareHash } from '../io/refresh';
import { PullReload, saidOf, useReload } from './PullReload';
import { longDate, nextFive, shiftHm, shortDate, zurichHm } from './format';
import { Icon } from './icons';
import { TripLine } from './TripLine';
import { TripLive } from './TripLive';
import { NotFound } from './NotFound';
import { OptionsBar } from './OptionsBar';
import { PricesSheet } from './PricesSheet';
import { PlanNotices } from './PlanNotices';
import { TripFacts } from './TripFacts';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { usePlanner } from './usePlanner';
import { useLayer } from './layers';
import { WhenField } from './WhenField';
import { rememberDeleted } from './undoDelete';
import { useStopIndex } from './useStopIndex';
import { log } from '../io/log';
import { findSubstitute } from '../io/substitute';
import { leaveTime } from '../core/spider';
import { useMapAdd } from './mapAdd';
import type { Kept } from './keepMap';
import { useDark } from './useDark';
import { RestEditor } from './RestEditor';
import { staysOnDay } from '../core/stay';
import { restDraft, useRestDrafts } from './restDraft';

/** Into that element (the map's column), else where it stands. */

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The entries a pick adds. */

/**
 * The one screen (SPEC §3a, 0.4.0): a trip is one line, always with a date. Before it leaves you
 * edit it in place and it plans itself; under way it shows where you are.
 */
/** The line's actions, each logged by name with its arguments (debug log). */
function logged<A extends object>(trip: string, act: A): A {
  return Object.fromEntries(
    Object.entries(act).map(([name, f]) => [
      name,
      (...args: unknown[]) => {
        // What it was called with, not the click that called it (`scrub` says an event's name).
        log(`line.${name}`, { trip, args });
        (f as (...a: unknown[]) => void)(...args);
      },
    ]),
  ) as A;
}

/** Logs what the line shows, once per timetable: stations struck, changes, rides. */
function LogRows({ trip, rows, at }: { trip: string; rows: LineRow[]; at: string }) {
  useEffect(() => {
    if (!at) return;
    log('trip.rows', {
      trip,
      rows: rows.map((r) =>
        r.type === 'ride'
          ? `[${r.section.category ?? r.section.mode} ${r.section.line ?? r.section.number ?? ''}]`
          : `${r.name}${r.missed ? ' (missed)' : ''}${r.role === 'change' ? ' (change)' : ''}`,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per timetable, not per render
  }, [trip, at]);
  return null;
}

export function TripScreen({ id }: { id: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const trip = useTrips((s) => s.trips.find((x) => x.id === id));
  const editRoute = useTrips((s) => s.editRoute);
  const update = useTrips((s) => s.update);
  const add = useTrips((s) => s.add);
  const remove = useTrips((s) => s.remove);
  const now = useNow();
  const liveStatus = useLiveStatus((s) => s.status);
  const index = useStopIndex();
  const stop = (r: string) => index?.byRef(stopKey(r));
  // Under way now: the one thing its time decides (0.52.0). Any other time it is edited in place.
  const liveTrip =
    trip &&
    isPlanned(trip) &&
    isLive(trip, now, expectedArrival(trip.chain.connections, liveStatus))
      ? trip
      : undefined;
  const live = useLive(liveTrip);
  // Under way, the rest being changed (0.46.0): edited in place, the same draft as the map's.
  const rest = useRestDrafts((s) => (liveTrip ? s.drafts[liveTrip.id] : undefined));
  const beginRest = (key: string | null) => {
    if (!liveTrip || !live.state) return;
    const d = restDraft(liveTrip, live.state, live.now);
    if (!d) return;
    // The station tapped, as the rest names it (by key); or the add sheet after its last.
    const open = key ? entriesOf(d.route).findIndex((e) => stopKey(e.w.stopRef) === key) : -1;
    log('replan.begin', { trip: liveTrip.id, at: key ? 'station' : 'add' });
    useRestDrafts
      .getState()
      .set(liveTrip.id, { ...d, focus: key && open > 0 ? { open } : key ? {} : { add: true } });
  };
  // Under way but not left yet: its options stay (from the saved plan, nothing asked).
  const notLeft = !!liveTrip && now < Date.parse(liveTrip.chain.dep);
  const planner = usePlanner(trip, !liveTrip || notLeft);
  const [open, setOpen] = useState<number | null>(null);
  // A new trip opens with the search: where it starts.
  const [sheet, setSheet] = useState<{ after: number } | null>(() =>
    trip && !trip.route.waypoints.length ? { after: -1 } : null,
  );
  const [menu, setMenu] = useState(false);
  const {
    busy: reloading,
    said: reloadSaid,
    reload,
  } = useReload(async () => {
    if (!trip || !isPlanned(trip)) return null;
    const before = trip.chain;
    const r = await reloadTrip(trip);
    // Changed meanwhile (edited, replanned): that is the newer trip.
    if (r.found || r.gone)
      update(trip.id, (x) =>
        x.chain === before
          ? compactTrip({
              ...x,
              chain: r.chain,
              savedAt: new Date().toISOString(),
              compact: undefined,
            })
          : x,
      );
    return saidOf(r, trip.route.date < dayOf(Date.now()));
  });
  const [renaming, setRenaming] = useState(false);
  // Said after Reverse direction dropped a stay's time window.
  const [windowsGone, setWindowsGone] = useState(false);
  useEffect(() => {
    if (!windowsGone) return;
    const t = setTimeout(() => setWindowsGone(false), 4000);
    return () => clearTimeout(t);
  }, [windowsGone]);
  // Escape and Android's Back close what is open on top first.
  const closeSheet = useCallback(() => setSheet(null), []);
  // The map planner: it adds after this entry, one after the other.
  // Beside the trip (desktop columns) it takes the map's column, not the trip's.
  const startMapAdd = useMapAdd((s) => s.start);
  const [prices, setPrices] = useState(false);
  // Keep map for offline (0.34.0): its progress while it runs, then what came of it.
  const [keeping, setKeeping] = useState<(Kept & { over: boolean }) | null>(null);
  const dark = useDark();
  const keepMap = () => {
    const ctrl = new AbortController();
    setKeeping({ done: 0, total: 0, failed: 0, over: false });
    // Loaded on the tap: it brings the map's own setup (MapLibre), not on the trip screen.
    import('./keepMap')
      .then((m) =>
        m.keepTripMap(route, trip?.chain?.connections, lang, dark, ctrl.signal, (k) =>
          setKeeping({ ...k, over: false }),
        ),
      )
      .then(
        (k) => setKeeping({ ...k, over: true }),
        () => setKeeping({ done: 0, total: 0, failed: 1, over: true }),
      );
  };
  // The menu item that opened it is gone with the menu: focus goes back to More.
  const moreButton = useRef<HTMLButtonElement>(null);
  const closePrices = useCallback(() => {
    setPrices(false);
    setTimeout(() => moreButton.current?.focus(), 0);
  }, []);
  // A via just unpinned, for a few seconds: Undo pins it back where it was.
  const [unpinned, setUnpinned] = useState<{
    k: number;
    stop: { stopRef: string; name: string };
  } | null>(null);
  useEffect(() => {
    if (!unpinned) return;
    const timer = setTimeout(() => setUnpinned(null), 6000);
    return () => clearTimeout(timer);
  }, [unpinned]);
  const closePanel = useCallback(() => setOpen(null), []);
  const closeMenu = useCallback(() => setMenu(false), []);
  useLayer(open !== null, closePanel);
  useLayer(menu, closeMenu);
  if (!trip) return <NotFound />;

  const route = trip.route;
  const name = trip.name || autoName(route, stop, lineName) || t('newTour');
  const entries = entriesOf(route);
  const edit = (f: (r: Tour) => Tour) => editRoute(id, f);
  const chain = trip.chain;
  // Planning from the first moment after an edit (the planner waits for edits to settle):
  // no flash of "nothing found" and no jump while it waits.
  const failed = planner.status === 'error' || planner.status === 'unavailable';
  const planning = !chain && route.waypoints.length >= 2 && planner.status === 'planning';
  // While the next plan comes, the last one stays on the line, dimmed: an edit never collapses
  // the line and jumps the page (the new station sits where it belongs, without times).
  const shown = chain ?? (planning ? planner.previous?.recommended : undefined);
  const rows = shown ? plannedRows(route, shown.connections) : routeRows(route);
  const anchor = 'departAt' in route.anchor ? route.anchor.departAt : route.anchor.arriveBy;
  const today = dayOf(now);

  const pick = (p: Picked) => {
    const at = sheet?.after ?? entries.length - 1;
    log('add.pick', { trip: id, kind: p.kind, after: at });
    if (p.kind === 'trip' && !route.waypoints.length && !trip.name)
      update(id, (x) => ({ ...x, name: p.tour.name }));
    edit((r) => insertEntries(r, at, entriesFor(p, r.date)));
    setSheet(null);
    setOpen(null);
  };

  // When: the date and the time it leaves from, at the top (before it is under way).
  const when = (
    <div className="when">
      <WhenField
        type="date"
        label={t('date')}
        value={route.date}
        min={earliestDay(today)}
        accept={(d) => acceptDate(d, today)}
        commit={(d) => {
          log('when.date', { trip: id, date: d });
          const hm = timeOnDate(d, today, nextFive(now), anchor);
          // A stay until a date and time moves with the trip (reported in review: it stayed).
          edit((r) => ({
            ...r,
            date: d,
            waypoints: staysOnDay(r.waypoints, r.date, d),
            ...(hm !== anchor ? { anchor: { departAt: hm } } : {}),
          }));
        }}
      >
        {(d) => (
          <>
            <Icon name="calendar" size={18} />
            {d.slice(0, 4) === today.slice(0, 4) ? shortDate(d, lang) : longDate(d, lang)}
          </>
        )}
      </WhenField>
      {/* The first connection after this time is the trip; a time gone is one already under way. */}
      <WhenField
        type="time"
        label={t('departFrom')}
        value={anchor}
        accept={acceptTime}
        commit={(hm) => {
          log('when.time', { trip: id, time: hm });
          edit((r) => ({ ...r, anchor: { departAt: hm } }));
        }}
      >
        {(hm) => (
          <>
            <Icon name="clock" size={18} />
            {t('fromTime')} {hm}
          </>
        )}
      </WhenField>
    </div>
  );

  const optionsBar = (
    <>
      {/* Failed with nothing to choose from: the notice says it, no empty strip. */}
      {route.waypoints.length >= 2 && !(failed && !planner.result?.options?.length) && (
        <OptionsBar
          fromNow={!!liveTrip}
          trip={trip}
          result={planner.result}
          planning={planning}
          failed={failed}
          from={anchor}
          move={(min) => {
            log('options.move', { trip: id, min });
            edit((r) => ({ ...r, anchor: { departAt: shiftHm(anchor, min) } }));
          }}
          choose={(c, legs) =>
            // The trip takes it, and its time becomes the trip's: planning again (after
            // an edit) starts there.
            (
              log('options.choose', { trip: id, dep: c.dep, arr: c.arr }),
              update(id, (x) =>
                compactTrip({
                  ...x,
                  route: { ...x.route, anchor: { departAt: zurichHm(Date.parse(c.dep)) } },
                  chain: c,
                  legs,
                  compact: undefined,
                }),
              )
            )
          }
        />
      )}
    </>
  );

  return (
    <main className={`page trip-screen ${liveTrip ? 'now' : ''}`}>
      {isPlanned(trip) && <PullReload busy={reloading} said={reloadSaid} reload={reload} />}
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
        <span className="sp" />
        <button
          type="button"
          className="icon open-map"
          aria-label={t('map')}
          disabled={route.waypoints.length < 2}
          onClick={() => go(`/trip/${id}/map`)}
        >
          <Icon name="map" />
        </button>
        {isPlanned(trip) ? (
          <ShareButton label={t('shareTrip')} title={name} hash={() => shareHash(trip)} />
        ) : (
          // Its place kept until the trip has a timetable: the icons do not move.
          <button type="button" className="icon" aria-label={t('shareTrip')} disabled>
            <Icon name="share" />
          </button>
        )}
        <button
          ref={moreButton}
          type="button"
          className="icon"
          aria-label={t('more')}
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
          }}
        >
          <Icon name="more" />
        </button>
      </header>
      {menu && (
        <div className="menu-scrim" onClick={() => setMenu(false)}>
          {/* A disclosure of plain buttons, not an ARIA menu (no arrow-key menu behaviour). */}
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            {isPlanned(trip) && (
              <button
                type="button"
                disabled={reloading}
                onClick={() => {
                  setMenu(false);
                  void reload();
                }}
              >
                <Icon name="refresh" size={18} />
                {t('reloadTrip')}
              </button>
            )}
            {isPlanned(trip) && (
              <button
                type="button"
                onClick={() => {
                  log('export.ics', { trip: id });
                  downloadIcs(route, name, trip.chain, trip.id);
                  setMenu(false);
                }}
              >
                <Icon name="calendar" size={18} />
                {t('calendar')}
              </button>
            )}
            {isPlanned(trip) && (
              <button
                type="button"
                onClick={() => {
                  log('trip.print', { trip: id });
                  setMenu(false);
                  // After the menu has gone, so it is not on the page.
                  requestAnimationFrame(() => window.print());
                }}
              >
                <Icon name="print" size={18} />
                {t('print')}
              </button>
            )}
            {isPlanned(trip) && (
              <button
                type="button"
                onClick={() => {
                  log('trip.prices', { trip: id });
                  setMenu(false);
                  setPrices(true);
                }}
              >
                <Icon name="ticket" size={18} />
                {t('pricesOnSbb')}
              </button>
            )}
            {isPlanned(trip) && (
              <button
                type="button"
                disabled={!!keeping && !keeping.over}
                onClick={() => {
                  log('trip.keepMap', { trip: id });
                  setMenu(false);
                  keepMap();
                }}
              >
                <Icon name="map" size={18} />
                {t('keepMap')}
              </button>
            )}
            {/* Before it leaves only: under way, Replan from here changes the rest. */}
            {!liveTrip && entries.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  let dropped = false;
                  edit((r) => {
                    const x = reverseRoute(r);
                    dropped = x.windowsDropped;
                    return x.tour;
                  });
                  log('trip.reverse', { trip: id, windowsDropped: dropped });
                  setWindowsGone(dropped);
                  setMenu(false);
                }}
              >
                <Icon name="reverse" size={18} />
                {t('reverseDirection')}
              </button>
            )}
            {
              <button
                type="button"
                onClick={() => {
                  const quiet = !trip.quiet;
                  log('trip.notifications', { trip: id, on: !quiet });
                  update(id, ({ quiet: _, ...x }) => (quiet ? { ...x, quiet: true } : x));
                  setMenu(false);
                }}
              >
                <Icon name="bell" size={18} />
                {t(trip.quiet ? 'notificationsOn' : 'notificationsOff')}
              </button>
            }
            <button
              type="button"
              onClick={() => {
                const copy = crypto.randomUUID();
                const r = {
                  ...structuredClone(route),
                  // The name you gave it comes along.
                  name: trip.name,
                  id: copy,
                  date: addDays(route.date < today ? today : route.date, 7),
                };
                add(newTrip(copy, r, undefined, undefined, new Date()));
                setMenu(false);
                go(`/trip/${copy}`);
              }}
            >
              <Icon name="loop" size={18} />
              {t('duplicate')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                // At once; the list offers Undo for a few seconds.
                rememberDeleted(trip);
                remove(id);
                go('/');
              }}
            >
              <Icon name="trash" size={18} />
              {t('deleteTrip')}
            </button>
          </div>
        </div>
      )}

      <div className="toast" role="status" hidden={!windowsGone}>
        <span>{windowsGone ? t('windowsDropped') : ''}</span>
      </div>

      {!liveTrip && when}

      {renaming ? (
        <input
          className="title-input"
          aria-label={t('tourName')}
          defaultValue={name}
          autoFocus
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            // Escape cancels: the name as it was.
            if (e.key === 'Escape') {
              e.currentTarget.value = name;
              // Only the name: the panel or menu behind it stays open.
              e.preventDefault();
              e.stopPropagation();
            }
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const v = e.target.value.trim();
            update(id, (x) => ({ ...x, name: v === autoName(route, stop, lineName) ? '' : v }));
            setRenaming(false);
          }}
        />
      ) : (
        <h1>
          {/* The pencil says the name can be changed; the label says so to a screen reader. */}
          <button
            type="button"
            className="title"
            aria-label={`${name}. ${t('renameTrip')}`}
            title={t('renameTrip')}
            onClick={() => setRenaming(true)}
          >
            {name}
            <Icon name="edit" size={16} />
          </button>
        </h1>
      )}

      {liveTrip ? (
        rest && live.state ? (
          <RestEditor trip={liveTrip} state={live.state} now={live.now} />
        ) : (
          <TripLive
            trip={liveTrip}
            live={live}
            edit={beginRest}
            // Not left yet: another connection can still be chosen (an earlier one never ends it).
            options={notLeft ? optionsBar : null}
          />
        )
      ) : (
        <>
          {chain && <TripFacts chain={chain} />}
          <PlanNotices
            state={
              planning ? 'planning' : failed ? (planner.status as 'error' | 'unavailable') : 'done'
            }
            detail={planner.detail}
            result={planner.result}
            retry={planner.retry}
          />
          {optionsBar}

          <LogRows
            trip={id}
            rows={rows}
            at={chain ? `${chain.dep}|${chain.arr}|${JSON.stringify(route.waypoints).length}` : ''}
          />
          <TripLine
            route={route}
            rows={rows}
            warnings={chain?.warnings ?? []}
            planning={planning}
            open={open}
            setOpen={setOpen}
            act={{
              ...logged(id, {
                replace: (k: number, s: { stopRef: string; name: string }) =>
                  edit((r) => replaceEntry(r, k, s)),
                stay: (k, min) => edit((r) => setEntryStay(r, k, min)),
                stayUntil: (k, v) => edit((r) => setEntryStayUntil(r, k, v)),
                move: (from, to) => {
                  edit((r) => moveEntry(r, from, to));
                  setOpen(to);
                },
                remove: (k) => {
                  const e = entries[k];
                  // A via unpinned: the way goes back to the plan, and Undo puts it back.
                  if (e && e.w.kind === 'via' && k > 0 && k < entries.length - 1)
                    setUnpinned({ k, stop: { stopRef: e.w.stopRef, name: e.w.name } });
                  edit((r) => removeEntry(r, k));
                  setOpen(null);
                },
                pin: (k, stop, then) => {
                  log('line.pin', { trip: id, after: k, then });
                  edit((r) => {
                    const x = insertEntries(r, k, [stationEntry(stop)]);
                    return then === 'stay' ? setEntryStay(x, k + 1, DEFAULT_STAY) : x;
                  });
                  if (then === 'add') setSheet({ after: k + 1 });
                  else setOpen(k + 1);
                },
                dropLine: (k) => edit((r) => dropLine(r, k)),
                addAfter: (k) => setSheet({ after: k }),
                add: () => setSheet({ after: entries.length - 1 }),
                later: () => edit((r) => ({ ...r, anchor: { departAt: shiftHm(anchor, 60) } })),
              }),
              // Not through `logged`: it returns what it finds, and its signal is no log data.
              find: (k, signal) => findSubstitute(trip, k, signal),
            }}
          />
        </>
      )}

      {sheet && (
        <AddSheet
          title={
            sheet.after < 0
              ? t('whereStart')
              : t('addAfterStop', { stop: entries[sheet.after]?.w.name ?? '' })
          }
          after={entries[sheet.after]?.w}
          next={entries[sheet.after + 1]?.w}
          first={sheet.after === entries.length - 1 ? entries[0]?.w : undefined}
          sameWay={sheet.after === entries.length - 1 ? sameWayBack(route) : undefined}
          onPick={pick}
          onClose={closeSheet}
          onMap={
            sheet.after >= 0
              ? () => {
                  const w = entries[sheet.after]!.w;
                  log('mapPick.open', { trip: id, after: sheet.after });
                  // On the trip's own map: beside the trip (desktop columns), else its screen.
                  startMapAdd({
                    trip: id,
                    after: sheet.after,
                    from: { stopRef: w.stopRef, name: w.name },
                    at: leaveTime(route, trip.chain?.connections, w.stopRef),
                  });
                  setSheet(null);
                  if (!document.querySelector('.col-map .mapview')) go(`/trip/${id}/map`);
                }
              : undefined
          }
        />
      )}
      {prices && trip.chain && (
        <PricesSheet connections={trip.chain.connections} onClose={closePrices} />
      )}
      {keeping && (
        <p className="toast kept" role="status">
          <span>
            {!keeping.over
              ? t('keepMapRunning', { done: keeping.done, total: keeping.total || '…' })
              : !keeping.total
                ? t('keepMapFailed')
                : keeping.failed
                  ? t('keepMapPartly', { n: keeping.done - keeping.failed, total: keeping.total })
                  : t('keepMapDone', { n: keeping.total })}
          </span>
          {keeping.over && (
            <button type="button" className="text-button" onClick={() => setKeeping(null)}>
              {t('close')}
            </button>
          )}
        </p>
      )}
      {unpinned && (
        <p className="toast unpinned" role="status">
          <span>{t('unpinned', { stop: unpinned.stop.name })}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const { k, stop } = unpinned;
              edit((r) => insertEntries(r, k - 1, [stationEntry(stop)]));
              setUnpinned(null);
            }}
          >
            {t('undo')}
          </button>
        </p>
      )}
    </main>
  );
}
