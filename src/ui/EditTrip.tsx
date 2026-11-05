import { useCallback, useEffect, useState } from 'react';
import {
  dropLine,
  entriesOf,
  insertEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  setEntryStay,
  setEntryLeaveBy,
} from '../core/line';
import { expectedArrival } from '../core/live';
import type { Tour } from '../core/model';
import type { PlanResult, PlannedChain } from '../core/planner/plan';
import { mergeReplan, remainingRoute, replanPoint, travelledRoute } from '../core/replan';
import { plannedRows, routeRows } from '../core/rows';
import { isPlanned, revise, tripStatus, type PlannedTrip } from '../core/trip';
import { log } from '../io/log';
import { PlanningUnavailable, WorkerError } from '../io/ojp';
import { findSubstitute } from '../io/substitute';
import { planRoute } from '../io/planTrip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { AddSheet, entriesFor, type Picked } from './AddSheet';
import { shiftHm, zurichHm } from './format';
import { Icon } from './icons';
import { useLayer } from './layers';
import { NotFound } from './NotFound';
import { OptionsBar } from './OptionsBar';
import { PlanNotices, type PlanState } from './PlanNotices';
import { TripLine } from './TripLine';
import { go } from './useHash';
import { useLive, useLiveStatus } from './useLive';
import { useNow } from './useNow';
import { useStopIndex } from './useStopIndex';

/** Edits come in bursts (a stay, then another): plan once they settle, as on the trip screen. */
const QUIET_MS = 400;

interface Planned {
  json: string;
  state: PlanState;
  result: PlanResult | null;
  detail: string;
}

/**
 * Replan from here, while a trip is under way (before it, the trip screen edits it in place).
 * The same line, notices and options strip as the trip screen, planned as you edit; the
 * station you are at is fixed. Updating makes a new version (undo keeps one).
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
  const start = (x: PlannedTrip | undefined) => {
    const p = x && state ? replanPoint(x, state, now) : null;
    const draft = x && p ? remainingRoute(x, p) : null;
    return { point: p, draft, version: x?.version, initial: draft ? JSON.stringify(draft) : '' };
  };
  // The live state and time it was opened with: the cut is made again at saving, with stop
  // positions, so the travelled train keeps its track up to the stop.
  const [opened, setOpened] = useState(() => ({ state, now, version: trip?.version }));
  const [{ point, draft, initial }, setBase] = useState(() => start(trip));
  const setDraft = (f: (d: Tour) => Tour) =>
    setBase((b) => (b.draft ? { ...b, draft: f(b.draft) } : b));
  const index = useStopIndex();
  const [planned, setPlanned] = useState<Planned | null>(null);
  /** The last plan that came, for any version of the rest: shown dimmed while the next comes. */
  const [last, setLast] = useState<PlanResult | null>(null);
  const [changed, setChanged] = useState(false);
  const [picked, setPicked] = useState<PlannedChain | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ after: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const closePanel = useCallback(() => setOpen(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Escape and Android's Back close what is open first, as on the trip screen.
  useLayer(open !== null, closePanel);
  useLayer(sheet !== null, closeSheet);
  const json = draft ? JSON.stringify(draft) : '';

  // Plans the rest whenever it changes, as the trip screen does (the same shared request).
  useEffect(() => {
    if (!draft || !trip) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setPlanned({ json, state: 'planning', result: null, detail: '' });
      log('replan.start', { trip: id, stops: draft.waypoints.map((w) => w.name) });
      try {
        const r = await planRoute(
          { ...trip, id: `${trip.id}-replan`, route: draft },
          ctrl.signal,
          false,
        );
        if (ctrl.signal.aborted) return;
        log('replan.done', { trip: id, options: r.options?.length ?? 0, failedLeg: r.failedLeg });
        setPlanned({ json, state: 'done', result: r, detail: '' });
        setLast(r);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        log('replan.fail', { trip: id, e });
        setPlanned({
          json,
          state: e instanceof PlanningUnavailable ? 'unavailable' : 'error',
          result: null,
          detail: e instanceof WorkerError ? e.detail : e instanceof Error ? e.name : '',
        });
      }
    }, QUIET_MS);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // The trip object changes with every live poll; planning follows the draft and Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, attempt]);

  if (!trip || !point || !draft) return <NotFound />;

  const mine = planned?.json === json ? planned : null;
  const result = mine?.result ?? null;
  const planState: PlanState = mine ? mine.state : 'planning';
  const chain = picked ?? result?.recommended ?? null;
  const planning = planState === 'planning';
  // While the next plan comes the last one stays on the line, dimmed: nothing jumps.
  const shown = chain ?? (planning ? (last?.recommended ?? null) : null);
  const entries = entriesOf(draft);
  const rows = shown ? plannedRows(draft, shown.connections) : routeRows(draft);
  // The way here, grey above the rest; the station you are at starts the rest, so it is not
  // drawn twice (the travelled line ends with the ride that brought you).
  const travelled = travelledRoute(trip, point);
  const travelledRows = travelled ? plannedRows(travelled, point.keep) : [];
  const behind = travelledRows.slice(
    0,
    Math.max(
      0,
      travelledRows.findLastIndex((r) => r.type === 'station'),
    ),
  );
  // Nothing to update until the rest differs, or another connection was chosen.
  const dirty = json !== initial || picked !== null;
  const edit = (f: (x: Tour) => Tour) => {
    setDraft(f);
    setPicked(null);
  };
  const anchor = 'departAt' in draft.anchor ? draft.anchor.departAt : draft.anchor.arriveBy;

  const save = () => {
    if (!chain || !result) return;
    // Changed meanwhile (another device, another tab, undo): its legs and trains are not the
    // ones this plan was cut from.
    if (useTrips.getState().trips.find((x) => x.id === id)?.version !== opened.version)
      return setChanged(true);
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

  /** From where the trip is now, as it is now (changed elsewhere, or the train moved on). */
  const again = () => {
    const fresh = start(trip);
    setBase(fresh);
    setOpened({ state, now, version: trip.version });
    setPicked(null);
    setChanged(false);
    setOpen(null);
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

      {changed ? (
        <div role="alert" className="notice red">
          <span>{t('tripChangedMeanwhile')}</span>
          <button type="button" className="secondary small" onClick={again}>
            {t('startAgain')}
          </button>
        </div>
      ) : (
        <PlanNotices
          state={planState}
          detail={mine?.detail ?? ''}
          result={result}
          retry={() => setAttempt((a) => a + 1)}
        />
      )}

      {entries.length >= 2 &&
        !((planState === 'error' || planState === 'unavailable') && !result?.options?.length) && (
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
            failed={planState === 'error' || planState === 'unavailable'}
            from={anchor}
            move={(min) => edit((r) => ({ ...r, anchor: { departAt: shiftHm(anchor, min) } }))}
            // Its time becomes the rest's: planning again after an edit starts there.
            choose={(c) => {
              setDraft((r) => ({ ...r, anchor: { departAt: zurichHm(Date.parse(c.dep)) } }));
              setPicked(c);
            }}
          />
        )}

      {travelled && behind.length > 0 && (
        <TripLine
          travelled
          route={travelled}
          rows={behind}
          warnings={trip.chain.warnings.filter((w) => w.legIndex < point.keep.length)}
          planning={false}
        />
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
          replace: (k, s) => edit((r) => replaceEntry(r, k, s)),
          stay: (k, min) => edit((r) => setEntryStay(r, k, min)),
          leaveBy: (k, hm) => edit((r) => setEntryLeaveBy(r, k, hm)),
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
          // The rest's own: Use edits the draft. The station you are at is fixed and the way here
          // is behind you, so neither is ever offered or replaced.
          find: (k, signal) =>
            k === 0
              ? Promise.resolve(null)
              : findSubstitute(
                  { ...trip, id: `${trip.id}-replan`, route: draft },
                  k,
                  signal,
                  travelled?.waypoints.map((w) => w.stopRef) ?? [],
                ),
        }}
      />

      {chain && !changed && (
        <div className="dock">
          <div className="dock-inner">
            <button type="button" className="primary wide" disabled={!dirty} onClick={save}>
              {t('updateTrip')}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <AddSheet
          title={t('addAfterStop', { stop: entries[sheet.after]?.w.name ?? '' })}
          after={entries[sheet.after]?.w}
          next={entries[sheet.after + 1]?.w}
          // "Back to the start": the trip's own start, not where you are now.
          first={sheet.after === entries.length - 1 ? trip.route.waypoints[0] : undefined}
          onPick={pick}
          onClose={closeSheet}
        />
      )}
    </main>
  );
}
