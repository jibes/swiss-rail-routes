import { useCallback, useEffect, useRef, useState } from 'react';
import { expectedArrival } from '../core/live';
import {
  dropLine,
  entriesOf,
  insertEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  setEntryStayUntil,
  setEntryStay,
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
import { reloadTrip } from '../io/refresh';
import { PullReload, saidOf, useReload } from './PullReload';
import { longDate, nextFive, shiftHm, shortDate, zurichHm } from './format';
import { Icon } from './icons';
import { TripLine } from './TripLine';
import { TripLive } from './TripLive';
import { NotFound } from './NotFound';
import { OptionsBar } from './OptionsBar';
import { ShareSheet } from './ShareSheet';
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
import { RestApply } from './RestApply';
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
  // Under way, a change ahead being planned from where you are (0.62.0): the line waits for it.
  const pending = useRestDrafts((s) => (liveTrip ? !!s.drafts[liveTrip.id] : false));
  // What lies ahead, from where you are: the entries before it stay as ridden (`fixed`), and an
  // edit of the line maps onto the rest by its place (the rest's own tail is the trip's).
  const ahead =
    liveTrip && live.state && !pending ? restDraft(liveTrip, live.state, live.now) : null;
  const planner = usePlanner(trip, true);
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
  // Escape and Android's Back close what is open on top first.
  const closeSheet = useCallback(() => setSheet(null), []);
  const [prices, setPrices] = useState(false);
  // Closed, focus goes back to the button that opened it.
  const moreButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const closePrices = useCallback(() => {
    setPrices(false);
    setTimeout(() => shareButton.current?.focus(), 0);
  }, []);
  const closePanel = useCallback(() => setOpen(null), []);
  const closeMenu = useCallback(() => setMenu(false), []);
  useLayer(open !== null, closePanel);
  useLayer(menu, closeMenu);
  if (!trip) return <NotFound />;

  const route = trip.route;
  const name = trip.name || autoName(route, stop, lineName) || t('newTour');
  const entries = entriesOf(route);
  const edit = (f: (r: Tour) => Tour) => editRoute(id, f);
  // Under way: the entries behind you, and an entry's place in the rest from where you are.
  const restEntries = ahead ? entriesOf(ahead.route) : [];
  const fixed = ahead ? entries.length - (restEntries.length - 1) : 0;
  /**
   * A change of the line, at any time. Under way it is made on the rest from where you are,
   * planned and then the trip's (`RestApply`); the way behind you stays as ridden.
   */
  const change = (f: (r: Tour, at: (k: number) => number) => Tour) => {
    if (!liveTrip) return edit((r) => f(r, (k) => k));
    if (!ahead) return;
    const at = (k: number) => k - fixed + 1;
    log('replan.begin', { trip: id });
    useRestDrafts.getState().set(id, { ...ahead, route: f(ahead.route, at) });
  };
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
    change((r, k) => insertEntries(r, k(at), entriesFor(p, r.date)));
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
          fromNow={false}
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
        {/* What leaves the app, in one sheet (0.61.0): link, calendar, print, prices on SBB.
            Its place kept until the trip has a timetable: the icons do not move. */}
        <button
          ref={shareButton}
          type="button"
          className="icon"
          aria-label={t('shareTrip')}
          disabled={!isPlanned(trip)}
          onClick={() => {
            log('trip.share', { trip: id });
            setPrices(true);
          }}
        >
          <Icon name="share" />
        </button>
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

      {when}

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

      {/* Under way, what is live over the same screen (0.62.0): progress, next step, risks. */}
      {liveTrip && <TripLive trip={liveTrip} live={live} />}
      {liveTrip && <RestApply trip={liveTrip} />}
      {
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
            planning={planning || pending}
            open={open}
            setOpen={setOpen}
            live={liveTrip && live.state ? { state: live.state, now: live.now } : undefined}
            fixed={fixed}
            // Under way while a change ahead is planned, or before the live state is known:
            // nothing more is changed until it is the trip's.
            act={
              liveTrip && !ahead
                ? undefined
                : {
                    ...logged(id, {
                      replace: (k: number, s: { stopRef: string; name: string }) =>
                        change((r, at) => replaceEntry(r, at(k), s)),
                      stay: (k, min) => change((r, at) => setEntryStay(r, at(k), min)),
                      stayUntil: (k, v) => change((r, at) => setEntryStayUntil(r, at(k), v)),
                      move: (from, to) => {
                        change((r, at) => moveEntry(r, at(from), at(to)));
                        setOpen(liveTrip ? null : to);
                      },
                      remove: (k) => {
                        change((r, at) => removeEntry(r, at(k)));
                        setOpen(null);
                      },
                      // A station the plan chose, kept: yours after entry `k`, its panel open.
                      pin: (k, stop) => {
                        change((r, at) => insertEntries(r, at(k), [stationEntry(stop)]));
                        setOpen(liveTrip ? null : k + 1);
                      },
                      dropLine: (k) => change((r, at) => dropLine(r, at(k))),
                      addAfter: (k) => setSheet({ after: k }),
                      add: () => setSheet({ after: entries.length - 1 }),
                      later: () =>
                        change((r) => ({
                          ...r,
                          anchor: {
                            departAt: shiftHm(
                              'departAt' in r.anchor ? r.anchor.departAt : r.anchor.arriveBy,
                              60,
                            ),
                          },
                        })),
                    }),
                  }
            }
          />
        </>
      }

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
          onPick={pick}
          onClose={closeSheet}
        />
      )}
      {prices && isPlanned(trip) && <ShareSheet trip={trip} name={name} onClose={closePrices} />}
    </main>
  );
}
