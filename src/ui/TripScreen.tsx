import { useCallback, useEffect, useRef, useState } from 'react';
import { expectedArrival } from '../core/live';
import {
  dropLine,
  entriesOf,
  insertEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  setEntryStay,
} from '../core/line';
import type { Tour } from '../core/model';
import { autoName } from '../core/naming';
import { plannedRows, routeRows, type LineRow } from '../core/rows';
import { stopKey } from '../core/stops';
import { encodeTrip } from '../core/export/tripShare';
import { compactTrip, dayOf, isPlanned, newTrip, tripStatus } from '../core/trip';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { AddSheet, entriesFor, type Picked } from './AddSheet';
import { downloadIcs, ShareButton } from './ExportSheet';
import { longDate, nextHalfHour, shiftHm, zurichHm } from './format';
import { Icon } from './icons';
import { TripLine } from './TripLine';
import { TripLive } from './TripLive';
import { NotFound } from './NotFound';
import { OptionsBar } from './OptionsBar';
import { PlanNotices } from './PlanNotices';
import { TripFacts } from './TripFacts';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { usePlanner } from './usePlanner';
import { useLayer } from './layers';
import { rememberDeleted } from './undoDelete';
import { useStopIndex } from './useStopIndex';
import { log } from '../io/log';

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
  const status = trip
    ? tripStatus(
        trip,
        now,
        trip.chain ? expectedArrival(trip.chain.connections, liveStatus) : undefined,
      )
    : 'upcoming';
  const liveTrip = trip && status === 'live' && isPlanned(trip) ? trip : undefined;
  const live = useLive(liveTrip);
  const planner = usePlanner(trip, !liveTrip);
  const [open, setOpen] = useState<number | null>(null);
  // A new trip opens with the search: where it starts.
  const [sheet, setSheet] = useState<{ after: number } | null>(() =>
    trip && !trip.route.waypoints.length ? { after: -1 } : null,
  );
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dates, setDates] = useState(false);
  // Escape and Android's Back close what is open on top first.
  const closeSheet = useCallback(() => setSheet(null), []);
  const closePanel = useCallback(() => setOpen(null), []);
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeDates = useCallback(() => setDates(false), []);
  useLayer(open !== null, closePanel);
  useLayer(dates, closeDates);
  useLayer(menu, closeMenu);
  const strip = useRef<HTMLDivElement>(null);
  // The date strip opens at the trip's day, not at today.
  useEffect(() => {
    if (dates)
      strip.current
        ?.querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [dates]);

  if (!trip) return <NotFound />;

  const route = trip.route;
  const name = trip.name || autoName(route, stop) || t('newTour');
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
    edit((r) => insertEntries(r, at, entriesFor(p)));
    setSheet(null);
    setOpen(null);
  };

  return (
    <main className={`page trip-screen ${liveTrip ? 'now' : ''}`}>
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
        <span className="sp" />
        <button
          type="button"
          className="icon"
          aria-label={t('map')}
          disabled={route.waypoints.length < 2}
          onClick={() => go(`/trip/${id}/map`)}
        >
          <Icon name="map" />
        </button>
        {isPlanned(trip) ? (
          <ShareButton label={t('shareTrip')} title={name} hash={() => encodeTrip(trip)} />
        ) : (
          // Its place kept until the trip has a timetable: the icons do not move.
          <button type="button" className="icon" aria-label={t('shareTrip')} disabled>
            <Icon name="share" />
          </button>
        )}
        <button
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
            update(id, (x) => ({ ...x, name: v === autoName(route, stop) ? '' : v }));
            setRenaming(false);
          }}
        />
      ) : (
        <h1>
          <button type="button" className="title" onClick={() => setRenaming(true)}>
            {name}
          </button>
        </h1>
      )}

      {liveTrip ? (
        <TripLive trip={liveTrip} live={live} />
      ) : status === 'past' && isPlanned(trip) ? (
        // Over, until its day ends: the record, read-only (then it waits in search).
        <>
          <p className="notice">{t('doneToday')}</p>
          <TripLine
            route={route}
            rows={plannedRows(route, trip.chain.connections)}
            warnings={trip.chain.warnings}
            planning={false}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            className="eyebrow"
            aria-expanded={dates}
            onClick={() => setDates(!dates)}
          >
            {longDate(route.date, lang)}
            <Icon name="chevron" size={16} />
          </button>
          {dates && (
            <div className="dates" role="group" aria-label={t('date')} ref={strip}>
              {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className={`pill ${d === route.date ? 'on' : ''}`}
                  aria-pressed={d === route.date}
                  onClick={() => {
                    // Today: from the next half hour, not from a time already gone.
                    const soon = d === today ? nextHalfHour(now) : '';
                    edit((r) => ({
                      ...r,
                      date: d,
                      ...(soon && soon > anchor ? { anchor: { departAt: soon } } : {}),
                    }));
                    setDates(false);
                  }}
                >
                  {i === 0
                    ? t('today')
                    : i === 1
                      ? t('tomorrow')
                      : longDate(d, lang).replace(/,? \d{4}$/, '')}
                </button>
              ))}
              <label className="pill other-date">
                {t('otherDay')}
                <input
                  type="date"
                  min={today}
                  value={route.date}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    edit((r) => ({ ...r, date: e.target.value }));
                    setDates(false);
                  }}
                />
              </label>
            </div>
          )}

          {chain && <TripFacts chain={chain} />}
          <PlanNotices
            state={
              planning ? 'planning' : failed ? (planner.status as 'error' | 'unavailable') : 'done'
            }
            detail={planner.detail}
            result={planner.result}
            retry={planner.retry}
          />

          {/* Failed with nothing to choose from: the notice says it, no empty strip. */}
          {route.waypoints.length >= 2 && !(failed && !planner.result?.options?.length) && (
            <OptionsBar
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
            act={logged(id, {
              replace: (k, s) => edit((r) => replaceEntry(r, k, s)),
              stay: (k, min) => edit((r) => setEntryStay(r, k, min)),
              move: (from, to) => {
                edit((r) => moveEntry(r, from, to));
                setOpen(to);
              },
              remove: (k) => {
                edit((r) => removeEntry(r, k));
                setOpen(null);
              },
              dropLine: (k) => edit((r) => dropLine(r, k)),
              addAfter: (k) => setSheet({ after: k }),
              add: () => setSheet({ after: entries.length - 1 }),
              later: () => edit((r) => ({ ...r, anchor: { departAt: shiftHm(anchor, 60) } })),
            })}
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
          first={sheet.after === entries.length - 1 ? entries[0]?.w : undefined}
          onPick={pick}
          onClose={closeSheet}
        />
      )}
    </main>
  );
}
