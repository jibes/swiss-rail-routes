import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from 'react';
import { localParams, templateName, type RouteTemplate } from '../core/data';
import { entriesOf, lineTo, linesLostByMove } from '../core/line';
import type { Tour } from '../core/model';
import { pinAfter, towards, viasOnRides, type LineRow, type StationRow } from '../core/rows';
import { NOTICE_TYPES, type Warning } from '../core/warnings';
import { usePrefs, useT } from '../store';
import { badge, dayMonth } from './format';
import { duration, minutesBetween } from './format';
import { Icon } from './icons';
import { MissedNote } from './MissedNote';
import { TEMPLATES } from './TemplatePicker';
import { platformAt } from '../core/live';
import { ChangePlatform } from './ChangePlatform';
import { StationPanel, type LineActions } from './StationPanel';
import { isCurrent, Mids, rideOf, stationLive, When, type LiveCtx } from './lineLive';
import { useWalkSpans } from './walkSpans';
import { seatOn } from '../core/seat';
import { useWeather } from './useWeather';
import { WeatherCell } from './WeatherCell';

export type { LineActions } from './StationPanel';

const SEVERITY: Record<Warning['severity'], string> = { error: 'red', warn: 'amber', info: 'info' };

const isWalk = (r?: LineRow) => r?.type === 'ride' && r.section.mode === 'walk';

/** Only a stay is said: a change shows as a big dot with two times. */
function stayLabel(t: ReturnType<typeof useT>, r: StationRow, leaveBy?: string) {
  if (r.role !== 'stop' || !r.stay) return '';
  return leaveBy ? t('stayUntil', { min: r.stay, time: leaveBy }) : t('stayFor', { min: r.stay });
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
  travelled = false,
}: {
  /** Replan from here: the first station is where you are; only "Add after" it. */
  fixedFirst?: boolean;
  route: Pick<Tour, 'waypoints'> & Partial<Pick<Tour, 'travelClass'>>;
  rows: LineRow[];
  warnings: Warning[];
  planning: boolean;
  /** Nothing to edit (under way, a shared trip, a finished one): `act` absent. */
  open?: number | null;
  setOpen?: (k: number | null) => void;
  act?: LineActions;
  /** Under way: expected times, the travelled part grey, the marker where you are. */
  live?: LiveCtx;
  /** Replan: the way here, grey, above the line of the rest. */
  travelled?: boolean;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const entries = entriesOf(route);
  const n = entries.length;
  const box = useRef<HTMLOListElement>(null);
  useWalkSpans(box);
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
    return tp ? templateName(tp, lang) : '';
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
  /** Your via between your first and last station: pinned (the plan must pass it). */
  const pinnedAt = (k: number) =>
    k > 0 &&
    k < n - 1 &&
    entries[k]?.w.kind === 'via' &&
    // A scenic line's ends are the line's (you chose the line): they keep the whole panel.
    !lineTo(entries, k) &&
    !lineTo(entries, k + 1);
  const onRideRows = new Set([...onRide.values()].flat().map((v) => v.row));

  /** A station's name: opens the panel (yours), says why not (the timetable's), or just is. */
  const nameOf = (r: StationRow, i: number) => {
    const k = act ? r.entry : undefined;
    const isOpen = k !== undefined && open === k;
    const label = stayLabel(t, r, r.entry !== undefined ? entries[r.entry]?.w.leaveBy : undefined);
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
        <span className="n">
          {r.name}
          {pinnedAt(k) && (
            <>
              <span className="pin-mark" title={t('pinnedVia')} aria-hidden="true">
                <Icon name="pin" size={14} />
              </span>
              <span className="sr-only">{t('pinnedVia')}</span>
            </>
          )}
        </span>
        {label && <span className={`chip ${r.stay ? '' : 'quiet'}`}>{label}</span>}
      </button>
    );
  };

  /**
   * A station the plan chose, opened: a card as your own stations' panel, with its name, why it
   * is there and, where it can be made yours after entry `k`, Pin, Stay here, Add stop from here.
   */
  const planPanel = (
    k: number | undefined,
    stop: { stopRef: string; name: string },
    why: string,
    close: () => void,
  ) => {
    const pin = k !== undefined && act?.pin;
    const made = (how?: 'stay' | 'add') => {
      setHint(null);
      act!.pin!(k!, stop, how);
    };
    return (
      <div className="panel plan-panel" role="status">
        <div className="panel-head">
          <p className="panel-name">
            <span>{stop.name}</span>
          </p>
          <button type="button" className="icon" aria-label={t('close')} onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="panel-note">{why}</p>
        {pin && (
          <div className="pin-menu">
            <button type="button" className="pill" onClick={() => made()}>
              <Icon name="pin" size={16} />
              {t('pinVia')}
            </button>
            <button type="button" className="pill" onClick={() => made('stay')}>
              {t('pinStay')}
            </button>
            <button type="button" className="pill" onClick={() => made('add')}>
              <Icon name="plus" size={16} />
              {t('pinAdd')}
            </button>
          </div>
        )}
      </div>
    );
  };

  const whyLocked = (r: StationRow, i: number) => {
    if (hint !== `${r.key}@${i}`) return null;
    const k = act?.pin ? pinAfter(rows, i, entries) : undefined;
    return planPanel(
      k,
      { stopRef: r.key, name: r.name },
      r.ring && lineName(r.line)
        ? t('partOfLine', { line: lineName(r.line) })
        : t(k !== undefined ? 'timetableStopPin' : 'timetableStop'),
      () => setHint(null),
    );
  };

  /** The open station's grip and panel. */
  const editing = (r: StationRow) => {
    const k = act ? r.entry : undefined;
    if (k === undefined || open !== k) return null;
    return (
      <>
        {n > 1 && !(fixedFirst && k === 0) && !pinnedAt(k) && (
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
          <StationPanel
            k={k}
            n={n}
            fixed={fixedFirst ? 1 : 0}
            name={r.name}
            stay={entries[k]!.w.kind === 'via' ? null : entries[k]!.w.dwellMin}
            leaveBy={entries[k]!.w.leaveBy}
            line={lineName(lineTo(entries, k))}
            change={r.role === 'change'}
            pinnedHere={pinnedAt(k)}
            act={act}
            close={() => setOpen?.(null)}
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
        data-stop={r.key}
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

  // Weather along the line (0.37.0): a cell a row at the right, once the times are known.
  const weather = useWeather(rows, !planning && !travelled);
  const wx = weather && 'rows' in weather ? weather : null;
  // A row without weather of its own (a walk, a stop not placed) takes its neighbour's sky, so
  // the stripe runs on unbroken; its rain stays its own (none).
  const skyAt = (i: number) => (wx ? (wx.rows[i] ?? wx.rows[i - 1] ?? wx.rows[i + 1]) : undefined);
  const cell = (i: number, where: string, when?: string, along?: { open: boolean }) =>
    wx && (
      <WeatherCell
        w={wx.rows[i] ?? (skyAt(i) && { ...skyAt(i)!, rain: 0 })}
        next={skyAt(i + 1)}
        where={where}
        when={when}
        source={wx.source}
        at={wx.at}
        along={along}
      />
    );
  return (
    <ol
      className={`trip-line ${wx ? 'wx' : ''} ${planning ? 'planning' : ''} ${act ? '' : 'read'} ${live ? 'live' : ''} ${travelled ? 'past' : ''}`}
      ref={box}
      aria-label={travelled ? t('theWayHere') : t('theLine')}
    >
      {drag && <li className="dropmark" style={{ top: drag.markY }} aria-hidden="true" />}
      {weather && 'far' in weather && (
        <li className="wx-far">{t('wxFrom', { date: dayMonth(weather.far, lang) })}</li>
      )}
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
          const { now: platform, moved } = platformAt(s.from, lr?.stops[0]);
          const seat = seatOn(s, TEMPLATES);
          const dest = towards(s);
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
                    {dest && (
                      <span className="towards">
                        <span aria-hidden="true">→ {dest}</span>
                        <span className="sr-only">{t('towards', { to: dest })}</span>
                      </span>
                    )}
                    {moved ? (
                      <span className="platform-moved">
                        <s aria-hidden="true">{t('platform', { p: moved.was })}</s>{' '}
                        <b aria-hidden="true">{t('platform', { p: moved.now })}</b>
                        <span className="sr-only">
                          {t('platformChanged', { was: moved.was, p: moved.now })}
                        </span>
                      </span>
                    ) : (
                      platform && <span>{t('platform', { p: platform })}</span>
                    )}
                    {min > 0 && <span>{duration(min)}</span>}
                    {seat && (
                      <span className="seat">{t(seat === 'R' ? 'nSideRight' : 'nSideLeft')}</span>
                    )}
                    {(() => {
                      // How full, for your class: said only when seats are few (0.39.0).
                      const o = s.occupancy?.[route.travelClass === 1 ? 0 : 1];
                      return o && o > 1 ? (
                        <span className={`occ occ-${o}`}>
                          {t(o === 3 ? 'occStanding' : 'occFew')}
                        </span>
                      ) : null;
                    })()}
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
                    wx={
                      wx
                        ? (call) => (
                            <WeatherCell
                              mid
                              w={wx.rows[i]?.mids?.[call]}
                              where={s.intermediate[call]!.name}
                              when={s.intermediate[call]!.dep ?? s.intermediate[call]!.arr}
                              source={wx.source}
                              at={wx.at}
                            />
                          )
                        : undefined
                    }
                    via={(call, when, passed) => {
                      const v = vias.find((x) => x.call === call);
                      return v ? viaRow(rows[v.row] as StationRow, v.row, when, passed) : null;
                    }}
                    // A stop the train calls at: yours with a tap, as a station the plan chose.
                    pin={(() => {
                      const k = act?.pin ? pinAfter(rows, i, entries) : undefined;
                      if (k === undefined) return undefined;
                      return {
                        open: (call: number) => hint === `${id}:${call}`,
                        toggle: (call: number) =>
                          setHint(hint === `${id}:${call}` ? null : `${id}:${call}`),
                        menu: (call: number) =>
                          planPanel(
                            k,
                            { stopRef: mids[call]!.stopRef, name: mids[call]!.name },
                            t('timetableStopPin'),
                            () => setHint(null),
                          ),
                      };
                    })()}
                  />
                )}
                {ws.map((w, j) => {
                  const text =
                    w.type === 'seasonal'
                      ? (TEMPLATES.find((x) => x.id === w.params.template)?.season?.note[lang] ??
                        t(w.key, w.params))
                      : t(w.key, localParams(w.params, lang, TEMPLATES));
                  // A disruption opens the operator's own message on a tap.
                  const detail = NOTICE_TYPES.has(w.type) && s.notices?.length ? s.notices : null;
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
                          {detail.map((d, k) => {
                            // Until when, and the operator's own remarks (0.19.1).
                            const info = s.noticeInfo?.[k];
                            return (
                              <span key={k}>
                                {d}
                                {info?.until &&
                                  ` ${t('noticeUntil', { date: dayMonth(info.until, lang) })}`}
                                {info?.detail && <span className="notice-more">{info.detail}</span>}
                              </span>
                            );
                          })}
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
              {cell(
                i,
                s.mode === 'walk' ? s.to.name : `${s.from.name} – ${s.to.name}`,
                s.from.dep,
                s.mode === 'walk' ? undefined : { open: shown },
              )}
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
            data-stop={r.key}
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
            {!!r.stay && wx && (wx.rows[i]?.rain ?? 0) >= 0.5 && (
              <p className="warn info wx-note">
                {t('wxRainStay', { n: Math.round(wx.rows[i]!.rain * 100) })}
              </p>
            )}
            {!planning && !r.missed && <ChangePlatform rows={rows} i={i} live={live} />}
            {L?.here && <span className="sr-only">{t('youAreHere')}</span>}
            {whyLocked(r, i)}
            {r.missed && !(rows[i - 1] as StationRow | undefined)?.missed && (
              <MissedNote
                // A new route (an edit, an hour later) drops a suggestion and stops a search.
                key={JSON.stringify(route.waypoints)}
                rows={rows}
                i={i}
                warnings={warnings}
                later={act?.later}
                find={act?.find}
                use={act?.replace}
              />
            )}
            {editing(r)}
            {cell(i, r.name, r.arr ?? r.dep)}
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
