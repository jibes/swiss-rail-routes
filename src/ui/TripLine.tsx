import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from 'react';
import type { RouteTemplate } from '../core/data';
import { entriesOf, lineTo, linesLostByMove } from '../core/line';
import type { Tour } from '../core/model';
import { missedByDisruption, viasOnRides, type LineRow, type StationRow } from '../core/rows';
import type { Warning } from '../core/warnings';
import { usePrefs, useT } from '../store';
import { badge } from './format';
import { duration, minutesBetween } from './format';
import { Icon } from './icons';
import { StopPicker } from './StopPicker';
import { TEMPLATES } from './TemplatePicker';
import { isCurrent, Mids, rideOf, stationLive, When, type LiveCtx } from './lineLive';

export interface LineActions {
  replace: (k: number, stop: { stopRef: string; name: string }) => void;
  stay: (k: number, min: number | null) => void;
  move: (from: number, to: number) => void;
  remove: (k: number) => void;
  dropLine: (k: number) => void;
  addAfter: (k: number) => void;
  add: () => void;
  /** An hour later (a station not reached may be at another time). */
  later: () => void;
}

/** A stay goes up and down in quarter hours; any length can be typed (to 10 h). */
const STAY_STEP = 15;
const STAY_MAX = 600;
const clampStay = (m: number) => Math.min(STAY_MAX, Math.max(1, Math.round(m)));
const SEVERITY: Record<Warning['severity'], string> = { error: 'red', warn: 'amber', info: 'info' };

const isWalk = (r?: LineRow) => r?.type === 'ride' && r.section.mode === 'walk';

/** Only a stay is said: a change shows as a big dot with two times. */
function stayLabel(t: ReturnType<typeof useT>, r: StationRow) {
  return r.role === 'stop' && r.stay ? t('stayFor', { min: r.stay }) : '';
}

/**
 * The trip as one line (SPEC §3a): what you entered are buttons that open the one panel (name,
 * stay, its scenic line, add after, up, down, remove; drag its grip); a line's stations are rings.
 */
export function TripLine({
  route,
  rows,
  warnings,
  planning,
  open,
  setOpen,
  act,
  fixedFirst = false,
  live,
}: {
  /** Replan from here: the first station is where you are; only "Add after" it. */
  fixedFirst?: boolean;
  route: Pick<Tour, 'waypoints'>;
  rows: LineRow[];
  warnings: Warning[];
  planning: boolean;
  /** Nothing to edit (under way, a shared trip, a finished one): `act` absent. */
  open?: number | null;
  setOpen?: (k: number | null) => void;
  act?: LineActions;
  /** Under way: expected times, the travelled part grey, the marker where you are. */
  live?: LiveCtx;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const entries = entriesOf(route);
  const n = entries.length;
  const box = useRef<HTMLOListElement>(null);
  // A station the timetable added (grey): a tap says why it cannot be edited.
  // Keyed by the station, not its place: an edit moves rows.
  const [hint, setHint] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  // A ride's stops between: a tap decides; until then the ride being travelled shows them.
  const [midsOpen, setMidsOpen] = useState<Map<string, boolean>>(new Map());
  const [drag, setDrag] = useState<{
    from: number;
    dy: number;
    to: number;
    lost: string[];
    markY: number;
  } | null>(null);

  const lineName = (id?: string) => {
    const tp: RouteTemplate | undefined = TEMPLATES.find((x) => x.id === id);
    return tp?.name ?? '';
  };
  const warnsFor = (leg: number, section: number, first: boolean) =>
    warnings.filter(
      (w) =>
        w.legIndex === leg &&
        (w.sectionIndex === section || (first && w.sectionIndex === undefined)),
    );

  const startDrag = (k: number, e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const list = box.current;
    if (!list) return;
    const y0 = e.clientY;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    let moved = false;
    let to = k;
    const others = () =>
      [...list.querySelectorAll<HTMLElement>('[data-entry]')].filter(
        (el) => Number(el.dataset.entry) !== k,
      );
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      const rest = others();
      const below = rest.filter((el) => {
        const b = el.getBoundingClientRect();
        return ev.clientY > b.top + b.height / 2;
      }).length;
      // Nothing moves above the fixed station (replan: where you are).
      to = Math.max(fixedFirst ? 1 : 0, below);
      const top = list.getBoundingClientRect().top;
      const at =
        rest[to]?.getBoundingClientRect().top ?? rest.at(-1)?.getBoundingClientRect().bottom ?? top;
      setDrag({ from: k, dy, to, lost: linesLostByMove(route, k, to), markY: at - top });
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setDrag(null);
      if (moved && to !== k) act?.move(k, to);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  const onRide = viasOnRides(rows);
  const onRideRows = new Set([...onRide.values()].flat().map((v) => v.row));

  /** A station's name: opens the panel (yours), says why not (the timetable's), or just is. */
  const nameOf = (r: StationRow, i: number) => {
    const k = act ? r.entry : undefined;
    const isOpen = k !== undefined && open === k;
    const label = stayLabel(t, r);
    if (!act && r.entry !== undefined)
      return (
        // Nothing to edit: a station you entered is just its name.
        <div className="m">
          <span className="n">{r.name}</span>
          {label && <span className={`chip ${r.stay ? '' : 'quiet'}`}>{label}</span>}
        </div>
      );
    if (k === undefined)
      return (
        <button
          type="button"
          className="m locked"
          aria-expanded={hint === `${r.key}@${i}`}
          onClick={() => setHint(hint === `${r.key}@${i}` ? null : `${r.key}@${i}`)}
        >
          <span className="n">{r.name}</span>
          {label && <span className="chip quiet">{label}</span>}
        </button>
      );
    return (
      <button
        type="button"
        className="m"
        aria-expanded={isOpen}
        onClick={() => setOpen?.(isOpen ? null : k)}
      >
        <span className="n">{r.name}</span>
        {label && <span className={`chip ${r.stay ? '' : 'quiet'}`}>{label}</span>}
      </button>
    );
  };

  const whyLocked = (r: StationRow, i: number) =>
    hint === `${r.key}@${i}` && (
      <span className="why" role="status">
        {r.ring && lineName(r.line)
          ? t('partOfLine', { line: lineName(r.line) })
          : t('timetableStop')}
      </span>
    );

  /** The open station's grip and panel. */
  const editing = (r: StationRow) => {
    const k = act ? r.entry : undefined;
    if (k === undefined || open !== k) return null;
    return (
      <>
        {n > 1 && !(fixedFirst && k === 0) && (
          <button
            type="button"
            className="grip"
            aria-label={t('dragToMove', { stop: r.name })}
            onPointerDown={(e) => startDrag(k, e)}
          >
            <Icon name="grip" size={18} />
          </button>
        )}
        {!drag && act && (
          <Panel
            k={k}
            n={n}
            fixed={fixedFirst ? 1 : 0}
            name={r.name}
            stay={entries[k]!.w.kind === 'via' ? null : entries[k]!.w.dwellMin}
            line={lineName(lineTo(entries, k))}
            change={r.role === 'change'}
            act={act}
          />
        )}
      </>
    );
  };

  /** A route station on a ride: among the ride's stops, in white, editable as on the line. */
  const viaRow = (r: StationRow, i: number, when: ReactNode, passed: boolean) => {
    const k = act ? r.entry : undefined;
    const dragging = drag && k === drag.from;
    return (
      <li
        key={k !== undefined ? `e${k}` : `s${i}-${r.key}`}
        className={[
          'station',
          'pass',
          'via',
          r.ring ? 'ring' : '',
          r.entry === undefined ? 'auto' : 'entry',
          k !== undefined && open === k ? 'open' : '',
          dragging ? 'dragging' : '',
          passed ? 'passed' : '',
          drag && r.ring && r.line && drag.lost.includes(r.line) ? 'losing' : '',
        ].join(' ')}
        style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
        {...(k !== undefined ? { 'data-entry': k } : {})}
      >
        {planning ? (
          <span className="t">
            <span className="shim" />
          </span>
        ) : (
          when
        )}
        {nameOf(r, i)}
        {whyLocked(r, i)}
        {editing(r)}
      </li>
    );
  };

  return (
    <ol
      className={`trip-line ${planning ? 'planning' : ''} ${act ? '' : 'read'} ${live ? 'live' : ''}`}
      ref={box}
      aria-label={t('theLine')}
    >
      {drag && <li className="dropmark" style={{ top: drag.markY }} aria-hidden="true" />}
      {rows.map((r, i) => {
        if (r.type === 'ride') {
          const first = !rows.slice(0, i).some((x) => x.type === 'ride' && x.leg === r.leg);
          const s = r.section;
          const ws = warnsFor(r.leg, r.sectionIndex, first);
          const min =
            s.walkMin ?? (s.from.dep && s.to.arr ? minutesBetween(s.from.dep, s.to.arr) : 0);
          const id = `${r.leg}-${r.sectionIndex}`;
          const lr = rideOf(live, r);
          const riding = !!live && live.state.phase === 'riding' && isCurrent(live, r);
          const arrives = lr?.stops.at(-1)?.arr;
          const dep = lr?.stops[0]?.dep;
          const f =
            riding && dep && arrives
              ? Math.min(1, Math.max(0, (live.now - dep) / Math.max(1, arrives - dep)))
              : 0;
          const mids = s.mode === 'walk' ? [] : s.intermediate;
          const shown = mids.length > 0 && (midsOpen.get(id) ?? riding);
          const vias = onRide.get(i) ?? [];
          const platform = lr?.stops[0]?.platform ?? s.from.platform;
          return (
            // Keyed by what it is, not where: an edit reorders rows, and the open panel (with
            // the focus in it) must stay the same element.
            <li
              key={`r${id}`}
              className={[
                'ride',
                s.mode === 'walk' ? 'walk' : '',
                riding ? 'here' : '',
                shown || vias.length ? 'with-mids' : '',
                live && arrives !== undefined && arrives <= live.now ? 'passed' : '',
              ].join(' ')}
              style={riding ? ({ '--f': `${(f * 100).toFixed(1)}%` } as CSSProperties) : undefined}
            >
              <span className="t" />
              <span className="rail" />
              <div className="m">
                {s.mode === 'walk' ? (
                  <span>{t('walkMin', { n: min })}</span>
                ) : (
                  <>
                    <span className="badge">{badge(s)}</span>
                    {s.product && <b>{s.product}</b>}
                    {platform && <span>{t('platform', { p: platform })}</span>}
                    {min > 0 && <span>{duration(min)}</span>}
                    {mids.length > vias.length && (
                      <button
                        type="button"
                        className="mids-toggle"
                        aria-expanded={shown}
                        onClick={() => setMidsOpen((m) => new Map(m).set(id, !shown))}
                      >
                        {mids.length === 1 ? t('stop1') : t('stopsBetween', { n: mids.length })}
                      </button>
                    )}
                  </>
                )}
                {(shown || vias.length > 0) && (
                  <Mids
                    r={r}
                    live={live}
                    riding={riding}
                    all={shown}
                    via={(call, when, passed) => {
                      const v = vias.find((x) => x.call === call);
                      return v ? viaRow(rows[v.row] as StationRow, v.row, when, passed) : null;
                    }}
                  />
                )}
                {ws.map((w, j) => {
                  const text =
                    w.type === 'seasonal'
                      ? (TEMPLATES.find((x) => x.id === w.params.template)?.season?.note[lang] ??
                        t(w.key, w.params))
                      : t(w.key, w.params);
                  // A disruption opens the operator's own message on a tap.
                  const detail =
                    (w.type === 'disruption' || w.type === 'disruption-away') && s.notices?.length
                      ? s.notices
                      : null;
                  const wid = `${id}-${j}`;
                  return detail ? (
                    <span key={j} className="warn-wrap">
                      <button
                        type="button"
                        className={`warn ${SEVERITY[w.severity]} more`}
                        aria-expanded={more === wid}
                        onClick={() => setMore(more === wid ? null : wid)}
                      >
                        <span>{text}</span>
                        <Icon name="chevron" size={14} />
                      </button>
                      {more === wid && (
                        <span className="detail">
                          {detail.map((d, k) => (
                            <span key={k}>{d}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span key={j} className={`warn ${SEVERITY[w.severity]}`}>
                      {text}
                    </span>
                  );
                })}
              </div>
            </li>
          );
        }
        if (onRideRows.has(i)) return null;
        const k = act ? r.entry : undefined;
        const isOpen = k !== undefined && open === k;
        const L = stationLive(rows, i, live);
        // Where you change or stay: the arrival small above, the departure (what you act on) big.
        const both = (r.role === 'stop' || r.role === 'change') && !!r.arr && !!r.dep;
        const showDep = r.role === 'start' || both || (r.role !== 'end' && !!r.dep);
        const time = showDep ? (
          <When plan={r.dep} live={L?.dep} />
        ) : (
          <When plan={r.arr} live={L?.arr} />
        );
        const before = both ? <When plan={r.arr} live={L?.arr} /> : null;
        const big = r.role !== 'pass';
        const dragging = drag && k === drag.from;
        return (
          <li
            key={k !== undefined ? `e${k}` : `s${i}-${r.key}`}
            className={[
              'station',
              big ? 'off' : 'pass',
              r.missed ? 'missed' : '',
              r.ring ? 'ring' : '',
              r.entry === undefined ? 'auto' : 'entry',
              isOpen ? 'open' : '',
              dragging ? 'dragging' : '',
              L?.passed ? 'passed' : '',
              L?.here ? 'here' : '',
              isWalk(rows[i + 1]) ? 'walk-from' : '',
              isWalk(rows[i - 1]) ? 'walk-to' : '',
              drag && r.ring && r.line && drag.lost.includes(r.line) ? 'losing' : '',
            ].join(' ')}
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
            {...(k !== undefined ? { 'data-entry': k } : {})}
          >
            <span className="t">
              {before && !planning && <i>{before}</i>}
              {planning ? <span className="shim" /> : time}
            </span>
            <span className="rail">
              <span className="dot" />
            </span>
            {nameOf(r, i)}
            {L?.here && <span className="sr-only">{t('youAreHere')}</span>}
            {whyLocked(r, i)}
            {r.missed && !(rows[i - 1] as StationRow | undefined)?.missed && (
              <div className="missed-note">
                <span>
                  {
                    // An interruption on that stretch is the likely reason: say so.
                    missedByDisruption(rows, i, warnings)
                      ? t('notReachedDisrupted')
                      : t('notReached')
                  }
                </span>
                {/* A disruption (works, a closure) is not over in an hour: no point trying later. */}
                {act && !missedByDisruption(rows, i, warnings) && (
                  <button type="button" className="text-button" onClick={act.later}>
                    {t('tryLater')}
                  </button>
                )}
              </div>
            )}
            {editing(r)}
          </li>
        );
      })}
      {act && (
        <li className="addrow">
          <button type="button" onClick={act.add}>
            <span className="t" />
            <span className="rail">
              <span className="plus" aria-hidden="true">
                +
              </span>
            </span>
            <span className="m">{n ? t('addStation') : t('chooseStart')}</span>
          </button>
        </li>
      )}
    </ol>
  );
}

function Panel({
  k,
  n,
  fixed,
  name,
  stay,
  line,
  change,
  act,
}: {
  /** You asked to ride through, but the plan changes trains here. */
  change: boolean;
  k: number;
  n: number;
  /** How many stations at the start stay where they are (replan: the one you are at). */
  fixed: number;
  name: string;
  stay: number | null;
  line: string;
  act: LineActions;
}) {
  const t = useT();
  const inner = k > 0 && k < n - 1;
  if (k < fixed)
    return (
      <div className="panel">
        <div className="acts">
          <button type="button" className="pill" onClick={() => act.addAfter(k)}>
            <Icon name="plus" size={16} />
            {t('addAfter')}
          </button>
        </div>
      </div>
    );
  return (
    <div className="panel">
      <StopPicker
        // Another station picked: the field shows its name (the panel stays open).
        key={name}
        label={t('replaceStation')}
        initial={name}
        onPick={(s) => act.replace(k, { stopRef: s.ref, name: s.name })}
      />
      {inner && (
        <>
          {/* Ride through (changing if the timetable needs it), or stay (for how long below). A
              stop of 0 min (a replan's, an older trip's) has no stay: it reads as no stop. */}
          <div className="chips seg" role="group" aria-label={t('atThisStation')}>
            <button
              type="button"
              className={`pill ${!stay ? 'on' : ''}`}
              aria-pressed={!stay}
              onClick={() => stay !== null && act.stay(k, null)}
            >
              {t('noStop')}
            </button>
            <button
              type="button"
              className={`pill ${stay ? 'on' : ''}`}
              aria-pressed={!!stay}
              onClick={() => !stay && act.stay(k, 30)}
            >
              {t('stayHere')}
            </button>
          </div>
          {stay === null && change && <p className="panel-note">{t('changeNeeded')}</p>}
          {!!stay && <StayStepper k={k} name={name} stay={stay} act={act} />}
        </>
      )}
      {line && (
        <div className="chips">
          <span className="pill via-line">
            {t('viaLine', { line })}
            <button
              type="button"
              aria-label={t('withoutLine', { line })}
              onClick={() => act.dropLine(k)}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        </div>
      )}
      <button type="button" className="pill add-after" onClick={() => act.addAfter(k)}>
        <Icon name="plus" size={16} />
        {t('addAfter')}
      </button>
      <div className="acts">
        <button
          type="button"
          className="sq"
          aria-label={t('moveUp', { name })}
          disabled={k <= fixed}
          onClick={() => act.move(k, k - 1)}
        >
          <Icon name="up" size={18} />
        </button>
        <button
          type="button"
          className="sq"
          aria-label={t('moveDown', { name })}
          disabled={k === n - 1}
          onClick={() => act.move(k, k + 1)}
        >
          <Icon name="down" size={18} />
        </button>
        <span className="sp" />
        {n > 1 && (
          <button
            type="button"
            className="sq danger"
            aria-label={t('removeStation', { stop: name })}
            onClick={() => act.remove(k)}
          >
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * How long to stay: a quarter hour less or more, or the number typed (tap it). Saved when the
 * typing ends (Enter, leaving the field), not on every key: each change plans again.
 */
function StayStepper({
  k,
  name,
  stay,
  act,
}: {
  k: number;
  name: string;
  stay: number;
  act: LineActions;
}) {
  const t = useT();
  const commit = (v: string) => {
    const m = Number(v);
    if (v.trim() && Number.isFinite(m) && m > 0 && clampStay(m) !== stay) act.stay(k, clampStay(m));
  };
  return (
    <div className="stepper" role="group" aria-label={t('stayAtStop', { stop: name })}>
      <button
        type="button"
        className="sq"
        aria-label={t('stayShorter', { n: STAY_STEP })}
        disabled={stay <= STAY_STEP}
        onClick={() => act.stay(k, clampStay(stay - STAY_STEP))}
      >
        <Icon name="minus" size={18} />
      </button>
      <label className="stay-input">
        <input
          // A new value from the buttons replaces what was typed.
          key={stay}
          type="number"
          inputMode="numeric"
          min={1}
          max={STAY_MAX}
          defaultValue={stay}
          aria-label={t('stayMinutes', { stop: name })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span aria-hidden="true">{t('minUnit')}</span>
      </label>
      <button
        type="button"
        className="sq"
        aria-label={t('stayLonger', { n: STAY_STEP })}
        disabled={stay >= STAY_MAX}
        onClick={() => act.stay(k, clampStay(stay + STAY_STEP))}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
