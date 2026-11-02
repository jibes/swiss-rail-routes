import { useEffect, useState } from 'react';
import {
  dropLine,
  entriesOf,
  insertEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  setEntryStay,
} from '../core/line';
import { expectedArrival } from '../core/live';
import type { Tour } from '../core/model';
import { plan, type PlanResult, type PlannedChain } from '../core/planner/plan';
import { mergeReplan, remainingRoute, replanPoint, type ReplanPoint } from '../core/replan';
import { plannedRows, routeRows } from '../core/rows';
import { stopKey } from '../core/stops';
import { isPlanned, revise, tripStatus } from '../core/trip';
import { GA, TEMPLATES } from '../data';
import { log } from '../io/log';
import { fetchTrips, PlanningUnavailable, WorkerError } from '../io/ojp';
import { stopSearch } from '../io/stops';
import { useT } from '../store';
import { useTrips } from '../trips';
import { AddSheet, entriesFor, type Picked } from './AddSheet';
import { hhmm, shiftHm } from './format';
import { Icon } from './icons';
import { NotFound } from './NotFound';
import { OptionsBar } from './OptionsBar';
import { RailLoader } from './RailLoader';
import { TripLine } from './TripLine';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';

/** Edits come in bursts (a stay, then another): plan once they settle, as on the trip screen. */
const QUIET_MS = 400;

type Status = 'planning' | 'done' | 'error' | 'unavailable' | 'changed';

/**
 * Replan from here, while a trip is under way (before it, the trip screen edits it in place).
 * The same line and options strip as the trip screen, planned as you edit; the station you are
 * at is fixed, the travelled part grey above it. Updating makes a new version (undo keeps one).
 */
export function EditTrip({ id }: { id: string }) {
  const t = useT();
  const trip = useTrips((s) => {
    const x = s.trips.find((y) => y.id === id);
    return x && isPlanned(x) ? x : undefined;
  });
  const update = useTrips((s) => s.update);
  const nowOpen = useNow();
  const liveStatus = useLiveStatus((s) => s.status);
  const live =
    !!trip &&
    tripStatus(trip, nowOpen, expectedArrival(trip.chain.connections, liveStatus)) === 'live';
  const { state, now } = useLive(live ? trip : undefined);
  // The live state and time it was opened with: the cut is made again at saving, with stop
  // positions, so the travelled train keeps its track up to the stop.
  const [opened, setOpened] = useState(() => ({ state, now, version: trip?.version }));
  const [point, setPoint] = useState<ReplanPoint | null>(() =>
    trip && state ? replanPoint(trip, state, now) : null,
  );
  const index = useStopIndex();
  const [draft, setDraft] = useState<Tour | null>(() =>
    trip && point ? remainingRoute(trip, point) : null,
  );
  const [planned, setPlanned] = useState<{ json: string; result: PlanResult } | null>(null);
  const [status, setStatus] = useState<Status>('planning');
  const [picked, setPicked] = useState<PlannedChain | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ after: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const json = draft ? JSON.stringify(draft) : '';

  // Plans the rest whenever it changes. Under way the train moves on while you edit: the rest
  // then starts from where it is now.
  useEffect(() => {
    if (!draft || !trip || !point) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      let from = draft;
      const p = state ? replanPoint(trip, state, now) : null;
      if (p && p.stop.stopRef !== point.stop.stopRef) {
        const key = stopKey(p.stop.stopRef);
        const at = draft.waypoints.findIndex((w) => stopKey(w.stopRef) === key);
        const fresh = remainingRoute(trip, p);
        from = {
          ...draft,
          date: fresh.date,
          anchor: fresh.anchor,
          waypoints: [fresh.waypoints[0]!, ...draft.waypoints.slice(at > 0 ? at + 1 : 1)],
        };
        setPoint(p);
        setOpened({ state, now, version: opened.version });
        setDraft(from);
        return; // planned again for the new draft
      }
      setStatus('planning');
      log('replan.start', {
        trip: id,
        from: point.stop.name,
        stops: from.waypoints.map((w) => w.name),
      });
      try {
        const stops = await stopSearch();
        const r = await plan(from, {
          fetchTrips: (q) => fetchTrips(q, ctrl.signal),
          templates: TEMPLATES,
          ga: GA,
          stop: (x) => stops.byRef(x),
          trace: (event, data) => log(event, { trip: id, ...(data as object) }),
        });
        if (ctrl.signal.aborted) return;
        log('replan.done', { trip: id, options: r.options?.length ?? 0, failedLeg: r.failedLeg });
        setPlanned({ json: JSON.stringify(from), result: r });
        setPicked(null);
        setStatus('done');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        log('replan.fail', { trip: id, e });
        setStatus(e instanceof PlanningUnavailable ? 'unavailable' : 'error');
        setError(e);
      }
    }, QUIET_MS);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // The live state moves every poll; planning follows the draft, not each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);

  if (!trip || !point || !draft) return <NotFound />;

  const result = planned?.json === json ? planned.result : null;
  const chain = picked ?? result?.recommended ?? null;
  const planning = !result && status !== 'error' && status !== 'unavailable';
  const entries = entriesOf(draft);
  const rows = chain ? plannedRows(draft, chain.connections) : routeRows(draft);
  const edit = (f: (x: Tour) => Tour) => {
    setDraft((d) => (d ? f(d) : d));
    setPicked(null);
  };
  const detail =
    error instanceof WorkerError ? error.detail : error instanceof Error ? `${error.name}` : '';
  const anchor = 'departAt' in draft.anchor ? draft.anchor.departAt : draft.anchor.arriveBy;

  // Where the trip has been: the stations of the kept part, in order, with their times.
  const travelled = point.keep
    .flatMap((c) =>
      c.sections
        .filter((x) => x.mode !== 'walk')
        .flatMap((x) => [
          { name: x.from.name, at: x.from.dep ?? x.from.arr },
          { name: x.to.name, at: x.to.arr ?? x.to.dep },
        ]),
    )
    .filter((x, i, all) => x.name !== point.stop.name && (i === 0 || all[i - 1]!.name !== x.name));

  const save = () => {
    if (!chain || !result) return;
    // Changed meanwhile (another device, another tab, undo): its legs and trains are not the
    // ones this plan was cut from.
    if (useTrips.getState().trips.find((x) => x.id === id)?.version !== opened.version)
      return setStatus('changed');
    log('replan.save', { trip: id, dep: chain.dep, arr: chain.arr });
    update(id, (x) =>
      !isPlanned(x)
        ? x
        : revise(
            x,
            mergeReplan(
              x,
              (opened.state &&
                replanPoint(x, opened.state, opened.now, (key) => {
                  const st = index?.byRef(key);
                  return st ? [st.lon, st.lat] : undefined;
                })) ||
                point,
              result.legs ?? [],
              chain,
            ),
            new Date(),
          ),
    );
    go(`/trip/${id}`);
  };

  const pick = (p: Picked) => {
    const at = sheet?.after ?? entries.length - 1;
    edit((r) => insertEntries(r, at, entriesFor(p)));
    setSheet(null);
    setOpen(null);
  };

  return (
    <main className="page trip-screen replan">
      <header className="bar">
        <button
          type="button"
          className="icon"
          aria-label={t('back')}
          onClick={() => go(`/trip/${id}`)}
        >
          <Icon name="back" />
        </button>
      </header>
      <h1 className="page-title">{t('replanFrom', { stop: point.stop.name })}</h1>
      <p className="muted">{t('replanHint')}</p>

      {status === 'changed' && (
        <p role="alert" className="notice red">
          <span>{t('tripChangedMeanwhile')}</span>
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status" className="notice">
          {t('planUnavailable')}
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="notice red">
          <span>
            {/fetch|network|TypeError/i.test(detail)
              ? t('planOffline')
              : /^5\d\d/.test(detail)
                ? t('planServer')
                : t('planFailed')}
          </span>
        </p>
      )}
      {result?.failedLeg !== undefined && (
        <p role="alert" className="notice red">
          <span>
            {t('legFailed', {
              n: result.failedLeg + 1,
              from: result.legs?.[result.failedLeg]?.from.name ?? '',
              to: result.legs?.[result.failedLeg]?.to.name ?? '',
            })}
          </span>
        </p>
      )}
      {planning && (
        <div className="hero-loading" role="status">
          <RailLoader />
          <span className="muted">{t('planning')}</span>
        </div>
      )}

      {entries.length >= 2 && (
        <OptionsBar
          trip={{
            ...trip,
            id: `${trip.id}-replan`,
            route: draft,
            chain: chain ?? undefined,
            legs: chain ? result?.legs : undefined,
          }}
          result={result}
          planning={planning}
          failed={status === 'error' || status === 'unavailable'}
          from={anchor}
          move={(min) => edit((r) => ({ ...r, anchor: { departAt: shiftHm(anchor, min) } }))}
          choose={(c) => setPicked(c)}
        />
      )}

      {travelled.length > 0 && (
        <ol className="trip-line past" aria-label={t('travelled')}>
          {travelled.map((x, i) => (
            <li key={i} className="station pass">
              <span className="t">{x.at && hhmm(x.at)}</span>
              <span className="rail">
                <span className="dot" />
              </span>
              <span className="m">
                <span className="n">{x.name}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <TripLine
        route={draft}
        rows={rows}
        warnings={chain?.warnings ?? []}
        planning={planning}
        open={open}
        setOpen={setOpen}
        fixedFirst
        act={{
          // The first station is where you are: nothing moves before it.
          replace: (k, s) => k > 0 && edit((r) => replaceEntry(r, k, s)),
          stay: (k, min) => edit((r) => setEntryStay(r, k, min)),
          move: (from, to) => {
            if (from === 0 || to === 0) return;
            edit((r) => moveEntry(r, from, to));
            setOpen(to);
          },
          remove: (k) => {
            if (k === 0) return;
            edit((r) => removeEntry(r, k));
            setOpen(null);
          },
          dropLine: (k) => edit((r) => dropLine(r, k)),
          addAfter: (k) => setSheet({ after: k }),
          add: () => setSheet({ after: entries.length - 1 }),
          later: () => edit((r) => ({ ...r, anchor: { departAt: shiftHm(anchor, 60) } })),
        }}
      />

      {chain && (
        <div className="dock">
          <div className="dock-inner">
            <button type="button" className="primary wide" onClick={save}>
              {t('updateTrip')}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <AddSheet
          title={t('addAfterStop', { stop: entries[sheet.after]?.w.name ?? '' })}
          after={entries[sheet.after]?.w}
          onPick={pick}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}
