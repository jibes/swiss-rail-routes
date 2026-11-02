import { useCallback, useEffect, useRef, useState } from 'react';
import { expectedArrival } from '../core/live';
import {
  dropLine,
  entriesOf,
  insertEntries,
  lineEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  setEntryStay,
  stationEntry,
  type Entry,
} from '../core/line';
import type { Tour } from '../core/model';
import { autoName } from '../core/naming';
import { plannedRows, routeRows, type LineRow } from '../core/rows';
import { stopKey } from '../core/stops';
import { encodeTrip } from '../core/export/tripShare';
import { compactTrip, dayOf, isPlanned, newTrip, tripStatus } from '../core/trip';
import { usePrefs, useT } from '../store';
import { useTrips } from '../trips';
import { AddSheet, type Picked } from './AddSheet';
import { downloadIcs, ShareButton } from './ExportSheet';
import { duration, hhmm, longDate, minutesBetween, nextHalfHour, zurichHm } from './format';
import { Icon } from './icons';
import { TripLine } from './TripLine';
import { TripLive } from './TripLive';
import { OptionsBar } from './OptionsBar';
import { RailLoader } from './RailLoader';
import { ChainView } from './ChainView';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { usePlanner } from './usePlanner';
import { useLayer } from './layers';
import { rememberDeleted } from './undoDelete';
import { useStopIndex } from './useStopIndex';
import { log } from '../io/log';

/** Earlier/Later move the departure by an hour, within the day. */
function shifted(time: string, min: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + min));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The entries a pick adds. */
function entriesFor(p: Picked): Entry[] {
  if (p.kind === 'station') return [stationEntry(p.stop)];
  if (p.kind === 'line') return lineEntries(p.template, p.reversed);
  return entriesOf(p.tour);
}

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

  if (!trip)
    return (
      <main className="page">
        <p>{t('notFound')}</p>
        <button type="button" className="secondary" onClick={() => go('/')}>
          {t('back')}
        </button>
      </main>
    );

  const route = trip.route;
  const name = trip.name || autoName(route, stop) || t('newTour');
  const entries = entriesOf(route);
  const edit = (f: (r: Tour) => Tour) => editRoute(id, f);
  const chain = trip.chain;
  const rows = chain ? plannedRows(route, chain.connections) : routeRows(route);
  const planning = !chain && planner.status === 'planning';
  const anchor = 'departAt' in route.anchor ? route.anchor.departAt : route.anchor.arriveBy;
  const changes = chain ? chain.connections.reduce((n, c) => n + c.transfers, 0) : 0;
  // Disruptions are on the rides they concern; their number is said at the top.
  const disruptions = chain ? chain.warnings.filter((w) => w.type === 'disruption').length : 0;
  const trains = chain
    ? chain.connections.reduce((n, c) => n + c.sections.filter((s) => s.mode !== 'walk').length, 0)
    : 0;
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
          <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
            {isPlanned(trip) && (
              <button
                type="button"
                role="menuitem"
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
              role="menuitem"
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
              role="menuitem"
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
            if (e.key === 'Escape') e.currentTarget.value = name;
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
          <ChainView chain={trip.chain} dwell={trip.legs.map((l) => l.to.dwellMin)} />
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

          {chain && (
            <>
              <p className="hero-times">
                <span>{hhmm(chain.dep)}</span>
                <Icon name="next" size={28} />
                <span>{hhmm(chain.arr)}</span>
              </p>
              <p className="facts">
                {duration(minutesBetween(chain.dep, chain.arr))} ·{' '}
                {trains === 1 ? t('train1') : t('trainsN', { n: trains })}
                {changes > 0 &&
                  ` · ${changes === 1 ? t('transfer1') : t('transfers', { n: changes })}`}
                {disruptions > 0 && (
                  <>
                    {' · '}
                    <span className="red-text">
                      {disruptions === 1 ? t('disruption1') : t('disruptionsN', { n: disruptions })}
                    </span>
                  </>
                )}
              </p>
            </>
          )}
          {!chain && route.waypoints.length >= 2 && planning && (
            <div className="hero-loading">
              <RailLoader label={t('planning')} />
              <span className="muted">{t('planning')}</span>
            </div>
          )}

          {planner.status === 'unavailable' && (
            <p role="status" className="notice">
              {t('planUnavailable')}
            </p>
          )}
          {planner.status === 'error' && (
            <div role="alert" className="notice red">
              <span>
                {
                  // Plain words, not the error's text: offline, the server, or anything else.
                  /fetch|network|TypeError/i.test(planner.detail)
                    ? t('planOffline')
                    : /^5\d\d/.test(planner.detail)
                      ? t('planServer')
                      : t('planFailed')
                }
              </span>
              <button type="button" className="secondary small" onClick={planner.retry}>
                {t('retry')}
              </button>
            </div>
          )}
          {planner.result?.failedLeg !== undefined && (
            <p role="alert" className="notice red">
              {t('legFailed', {
                n: planner.result.failedLeg + 1,
                from: planner.result.legs?.[planner.result.failedLeg]?.from.name ?? '',
                to: planner.result.legs?.[planner.result.failedLeg]?.to.name ?? '',
              })}
            </p>
          )}
          {/* Stations not reached show on the line itself; an avoided stretch has no row. */}
          {planner.result?.relaxed
            .filter((r) => r.rule === 'avoid')
            .map((r, i) => (
              <p key={i} className="notice">
                {t('relaxedAvoidAt', {
                  from: planner.result?.legs?.[r.legIndex]?.from.name ?? '',
                  to: planner.result?.legs?.[r.legIndex]?.to.name ?? '',
                })}
              </p>
            ))}

          {route.waypoints.length >= 2 && (
            <OptionsBar
              trip={trip}
              result={planner.result}
              planning={planning}
              from={anchor}
              move={(min) => {
                log('options.move', { trip: id, min });
                edit((r) => ({ ...r, anchor: { departAt: shifted(anchor, min) } }));
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
              later: () => edit((r) => ({ ...r, anchor: { departAt: shifted(anchor, 60) } })),
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
