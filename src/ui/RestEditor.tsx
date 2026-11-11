// The rest of a trip under way, edited in place on the trip screen (0.46.0; before, its own
// screen, "Replan from here"). The way here grey above, then the rest from where you are (fixed),
// planned as you edit, with the same notices and options strip as before it leaves. A change is
// the trip's once its plan comes (0.60.0: no Update or Discard; Undo on the trip takes it back),
// and with nothing open and nothing changed the trip is shown as it runs again.
import { useCallback, useEffect, useState } from 'react';
import {
  dropLine,
  entriesOf,
  insertEntries,
  moveEntry,
  removeEntry,
  replaceEntry,
  setEntryStay,
  setEntryStayUntil,
} from '../core/line';
import type { LiveState } from '../core/live';
import type { Tour } from '../core/model';
import type { PlanResult } from '../core/planner/plan';
import { mergeReplan, replanPoint, travelledRoute } from '../core/replan';
import { plannedRows, routeRows } from '../core/rows';
import { isPlanned, revise, type PlannedTrip } from '../core/trip';
import { log } from '../io/log';
import { PlanningUnavailable, WorkerError } from '../io/ojp';
import { planRoute } from '../io/planTrip';
import { useT } from '../store';
import { useTrips } from '../trips';
import { AddSheet, entriesFor, type Picked } from './AddSheet';
import { shiftHm, zurichHm } from './format';
import { useLayer } from './layers';
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

  // Changed meanwhile (another device, another tab, undo): its legs and trains are not the ones
  // the rest was cut from.
  const changed = !!d && trip.version !== d.opened.version;
  // A change is the trip's once its plan is there; nothing open and nothing changed: done.
  useEffect(() => {
    if (!d) return;
    const r = planned?.json === json && planned.state === 'done' ? planned.result : null;
    const c = r ? (d.picked ?? r.recommended ?? null) : null;
    const dirtyNow = json !== d.initial || d.picked !== null;
    if (dirtyNow && r && c && !changed) {
      log('replan.save', { trip: id, dep: c.dep, arr: c.arr });
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
                }) || d.point,
                r.legs ?? [],
                c,
              ),
              new Date(),
            ),
      );
      drafts().discard(id);
    } else if (!dirtyNow && open === null && sheet === null) drafts().discard(id);
  }, [d, planned, json, changed, open, sheet, id, index, update, drafts]);

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

  const discard = () => {
    log('replan.discard', { trip: id });
    drafts().discard(id);
  };

  /** From where the trip is now, as it is now (changed elsewhere, or the train moved on). */
  const again = () => {
    const fresh = restDraft(trip, state, now);
    if (fresh) drafts().set(id, fresh);
    else drafts().discard(id);
    setOpen(null);
  };

  const pick = (p: Picked) => {
    const at = sheet?.after ?? entries.length - 1;
    edit((r) => insertEntries(r, at, entriesFor(p, r.date)));
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
        }}
      />

      {/* Changed, and no plan for it: the change is taken back here (else it waits). */}
      {dirty && (planState === 'error' || planState === 'unavailable') && (
        <p className="muted">
          <button type="button" className="text-button" onClick={discard}>
            {t('discardChanges')}
          </button>
        </p>
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
    </>
  );
}
