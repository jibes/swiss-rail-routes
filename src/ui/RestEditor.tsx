// The rest of a trip under way, edited in place on the trip screen (0.46.0; before, its own
// screen, "Replan from here"). The way here grey above, then the rest from where you are (fixed),
// planned as you edit, with the same notices and options strip as before it leaves; Update makes
// a new version (undo keeps one), Discard drops the draft. The draft lives in `restDraft`, so the
// map planner adds to the same one.
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
  setEntryStayUntil,
  sameWayBack,
} from '../core/line';
import type { LiveState } from '../core/live';
import type { Tour } from '../core/model';
import type { PlanResult } from '../core/planner/plan';
import { mergeReplan, replanPoint, travelledRoute, wholeWay } from '../core/replan';
import { plannedRows, routeRows } from '../core/rows';
import { isPlanned, revise, type PlannedTrip } from '../core/trip';
import { log } from '../io/log';
import { PlanningUnavailable, WorkerError } from '../io/ojp';
import { findSubstitute } from '../io/substitute';
import { planRoute } from '../io/planTrip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { AddSheet, entriesFor, type Picked } from './AddSheet';
import { shiftHm, zurichHm } from './format';
import { useLayer } from './layers';
import { useMapAdd } from './mapAdd';
import { go } from './useHash';
import { leaveTime } from '../core/spider';
import { OptionsBar } from './OptionsBar';
import { PlanNotices, type PlanState } from './PlanNotices';
import { restDraft, useRestDrafts } from './restDraft';
import { TripLine } from './TripLine';
import { useStopIndex } from './useStopIndex';

/** Edits come in bursts (a stay, then another): plan once they settle, as before it leaves. */
const QUIET_MS = 400;

interface Planned {
  json: string;
  state: PlanState;
  result: PlanResult | null;
  detail: string;
}

export function RestEditor({
  trip,
  state,
  now,
}: {
  trip: PlannedTrip;
  state: LiveState;
  now: number;
}) {
  const t = useT();
  const id = trip.id;
  const d = useRestDrafts((s) => s.drafts[id]);
  const drafts = useRestDrafts.getState;
  const update = useTrips((s) => s.update);
  const index = useStopIndex();
  const [planned, setPlanned] = useState<Planned | null>(null);
  /** The last plan that came, for any version of the rest: shown dimmed while the next comes. */
  const [last, setLast] = useState<PlanResult | null>(null);
  const [changed, setChanged] = useState(false);
  const [open, setOpen] = useState<number | null>(() => d?.focus?.open ?? null);
  const [sheet, setSheet] = useState<{ after: number } | null>(() =>
    d?.focus?.add ? { after: entriesOf(d.route).length - 1 } : null,
  );
  const [attempt, setAttempt] = useState(0);
  const closePanel = useCallback(() => setOpen(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  useLayer(open !== null, closePanel);
  useLayer(sheet !== null, closeSheet);
  const draft = d?.route;
  const json = draft ? JSON.stringify(draft) : '';

  // Plans the rest whenever it changes (the same shared request as before it leaves).
  useEffect(() => {
    if (!draft) return;
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

  if (!d || !draft) return null;
  const { point } = d;
  const mine = planned?.json === json ? planned : null;
  const result = mine?.result ?? null;
  const planState: PlanState = mine ? mine.state : 'planning';
  const chain = d.picked ?? result?.recommended ?? null;
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
  const dirty = json !== d.initial || d.picked !== null;
  const edit = (f: (x: Tour) => Tour) => drafts().edit(id, f);
  const anchor = 'departAt' in draft.anchor ? draft.anchor.departAt : draft.anchor.arriveBy;

  const save = () => {
    if (!chain || !result) return;
    // Changed meanwhile (another device, another tab, undo): its legs and trains are not the
    // ones this plan was cut from.
    if (useTrips.getState().trips.find((x) => x.id === id)?.version !== d.opened.version)
      return setChanged(true);
    log('replan.save', { trip: id, dep: chain.dep, arr: chain.arr });
    update(id, (x) =>
      !isPlanned(x)
        ? x
        : revise(
            x,
            mergeReplan(
              x,
              replanPoint(x, d.opened.state, d.opened.now, (key) => {
                const st = index?.byRef(key);
                return st ? [st.lon, st.lat] : undefined;
              }) || point,
              result.legs ?? [],
              chain,
            ),
            new Date(),
          ),
    );
    drafts().discard(id);
  };

  const discard = () => {
    log('replan.discard', { trip: id });
    drafts().discard(id);
  };

  /** From where the trip is now, as it is now (changed elsewhere, or the train moved on). */
  const again = () => {
    const fresh = restDraft(trip, state, now);
    if (fresh) drafts().set(id, fresh);
    else drafts().discard(id);
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
    <>
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
              edit((r) => ({ ...r, anchor: { departAt: zurichHm(Date.parse(c.dep)) } }));
              drafts().pick(id, c);
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
          stayUntil: (k, v) => edit((r) => setEntryStayUntil(r, k, v)),
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

      {!changed && (
        <div className="dock">
          <div className="dock-inner">
            <button type="button" className="secondary" onClick={discard}>
              {t('discardChanges')}
            </button>
            <button
              type="button"
              className="primary wide"
              disabled={!dirty || !chain}
              onClick={save}
            >
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
          // The whole way as it now stands, the way here included, retraced from the rest's end.
          sameWay={
            sheet.after === entries.length - 1 ? sameWayBack(wholeWay(travelled, draft)) : undefined
          }
          onPick={pick}
          onClose={closeSheet}
          // On the trip's map, into the rest: beside the trip (desktop columns), else its screen.
          onMap={() => {
            const w = entries[sheet.after]!.w;
            log('mapPick.open', { trip: id, after: sheet.after, rest: true });
            useMapAdd.getState().start({
              trip: id,
              after: sheet.after,
              from: { stopRef: w.stopRef, name: w.name },
              at: leaveTime(draft, chain?.connections, w.stopRef),
              rest: true,
            });
            setSheet(null);
            if (!document.querySelector('.col-map .mapview')) go(`/trip/${id}/map`);
          }}
        />
      )}
    </>
  );
}
