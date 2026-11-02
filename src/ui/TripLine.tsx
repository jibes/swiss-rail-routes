import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { RouteTemplate } from '../core/data';
import { entriesOf, lineTo, linesLostByMove } from '../core/line';
import type { Tour } from '../core/model';
import type { LineRow, StationRow } from '../core/rows';
import type { Warning } from '../core/warnings';
import { usePrefs, useT } from '../store';
import { badge } from './ChainView';
import { duration, hhmm, minutesBetween } from './format';
import { Icon } from './icons';
import { StopPicker } from './StopPicker';
import { TEMPLATES } from './TemplatePicker';

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

const STAYS = [0, 30, 60, 90, 120];
const SEVERITY: Record<Warning['severity'], string> = { error: 'red', warn: 'amber', info: 'info' };

/** Whether the ride that goes past a missed station (the next one on the line) is disrupted. */
function disruptedLeg(rows: LineRow[], i: number, warnings: Warning[]) {
  const next = rows.slice(i + 1).find((r) => r.type === 'station' && r.leg !== undefined);
  const leg = next?.type === 'station' ? next.leg : undefined;
  return leg !== undefined && warnings.some((w) => w.type === 'disruption' && w.legIndex === leg);
}

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
}: {
  /** Replan from here: the first station is where you are; only "Add after" it. */
  fixedFirst?: boolean;
  route: Pick<Tour, 'waypoints'>;
  rows: LineRow[];
  warnings: Warning[];
  planning: boolean;
  open: number | null;
  setOpen: (k: number | null) => void;
  act: LineActions;
}) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const entries = entriesOf(route);
  const n = entries.length;
  const box = useRef<HTMLOListElement>(null);
  // A station the timetable added (grey): a tap says why it cannot be edited.
  const [hint, setHint] = useState<number | null>(null);
  const [more, setMore] = useState<string | null>(null);
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
      to = below;
      const top = list.getBoundingClientRect().top;
      const at =
        rest[below]?.getBoundingClientRect().top ??
        rest.at(-1)?.getBoundingClientRect().bottom ??
        top;
      setDrag({ from: k, dy, to, lost: linesLostByMove(route, k, to), markY: at - top });
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setDrag(null);
      if (moved && to !== k) act.move(k, to);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  return (
    <ol className={`trip-line ${planning ? 'planning' : ''}`} ref={box} aria-label={t('theLine')}>
      {drag && <li className="dropmark" style={{ top: drag.markY }} aria-hidden="true" />}
      {rows.map((r, i) => {
        if (r.type === 'ride') {
          const first = !rows.slice(0, i).some((x) => x.type === 'ride' && x.leg === r.leg);
          const s = r.section;
          const ws = warnsFor(r.leg, r.sectionIndex, first);
          const min =
            s.walkMin ?? (s.from.dep && s.to.arr ? minutesBetween(s.from.dep, s.to.arr) : 0);
          return (
            // Keyed by what it is, not where: an edit reorders rows, and the open panel (with
            // the focus in it) must stay the same element.
            <li key={`r${r.leg}-${r.sectionIndex}`} className="ride">
              <span className="t" />
              <span className="rail" />
              <div className="m">
                {s.mode === 'walk' ? (
                  <span>{t('walkMin', { n: min })}</span>
                ) : (
                  <>
                    <span className="badge">{badge(s)}</span>
                    {s.product && <b>{s.product}</b>}
                    {s.from.platform && <span>{t('platform', { p: s.from.platform })}</span>}
                    {min > 0 && <span>{duration(min)}</span>}
                  </>
                )}
                {ws.map((w, j) => {
                  const text =
                    w.type === 'seasonal'
                      ? (TEMPLATES.find((x) => x.id === w.params.template)?.season?.note[lang] ??
                        t(w.key, w.params))
                      : t(w.key, w.params);
                  // A disruption opens the operator's own message on a tap.
                  const detail = w.type === 'disruption' && s.notices?.length ? s.notices : null;
                  const id = `${i}-${j}`;
                  return detail ? (
                    <span key={j} className="warn-wrap">
                      <button
                        type="button"
                        className={`warn ${SEVERITY[w.severity]} more`}
                        aria-expanded={more === id}
                        onClick={() => setMore(more === id ? null : id)}
                      >
                        {text}
                        <Icon name="chevron" size={14} />
                      </button>
                      {more === id && (
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
        const k = r.entry;
        const isOpen = k !== undefined && open === k;
        // Where you change or stay: the arrival small above, the departure (what you act on) big.
        const both = (r.role === 'stop' || r.role === 'change') && !!r.arr && !!r.dep;
        const time =
          r.role === 'start' || both
            ? r.dep && hhmm(r.dep)
            : r.role === 'end'
              ? r.arr && hhmm(r.arr)
              : (r.dep ?? r.arr) && hhmm((r.dep ?? r.arr)!);
        const before = both ? hhmm(r.arr!) : '';
        const big = r.role !== 'pass';
        const label = stayLabel(t, r);
        const dragging = drag && k === drag.from;
        return (
          <li
            key={k !== undefined ? `e${k}` : `s${i}-${r.key}`}
            className={[
              'station',
              big ? 'off' : 'pass',
              r.missed ? 'missed' : '',
              r.ring ? 'ring' : '',
              k === undefined ? 'auto' : 'entry',
              isOpen ? 'open' : '',
              dragging ? 'dragging' : '',
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
            {k === undefined ? (
              <button
                type="button"
                className="m locked"
                aria-expanded={hint === i}
                onClick={() => setHint(hint === i ? null : i)}
              >
                <span className="n">{r.name}</span>
                {label && <span className="chip quiet">{label}</span>}
              </button>
            ) : (
              <button
                type="button"
                className="m"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : k)}
              >
                <span className="n">{r.name}</span>
                {label && <span className={`chip ${r.stay ? '' : 'quiet'}`}>{label}</span>}
              </button>
            )}
            {hint === i && (
              <span className="why" role="status">
                {r.ring && lineName(r.line)
                  ? t('partOfLine', { line: lineName(r.line) })
                  : t('timetableStop')}
              </span>
            )}
            {r.missed && !(rows[i - 1] as StationRow | undefined)?.missed && (
              <div className="missed-note">
                <span>
                  {
                    // An interruption on that stretch is the likely reason: say so.
                    disruptedLeg(rows, i, warnings) ? t('notReachedDisrupted') : t('notReached')
                  }
                </span>
                <button type="button" className="text-button" onClick={act.later}>
                  {t('tryLater')}
                </button>
              </div>
            )}
            {isOpen && n > 1 && !(fixedFirst && k === 0) && (
              <button
                type="button"
                className="grip"
                aria-label={t('dragToMove', { stop: r.name })}
                onPointerDown={(e) => startDrag(k, e)}
              >
                <Icon name="grip" size={18} />
              </button>
            )}
            {isOpen && !drag && (
              <Panel
                k={k}
                n={n}
                fixed={fixedFirst ? 1 : 0}
                name={r.name}
                stay={entries[k]!.w.kind === 'via' ? null : entries[k]!.w.dwellMin}
                line={lineName(lineTo(entries, k))}
                act={act}
              />
            )}
          </li>
        );
      })}
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
  act,
}: {
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
        label={t('replaceStation')}
        initial={name}
        onPick={(s) => act.replace(k, { stopRef: s.ref, name: s.name })}
      />
      {inner && (
        <div className="chips" role="group" aria-label={t('atThisStation')}>
          <button
            type="button"
            className={`pill ${stay === null ? 'on' : ''}`}
            aria-pressed={stay === null}
            onClick={() => act.stay(k, null)}
          >
            {t('noStop')}
          </button>
          {STAYS.map((m) => (
            <button
              key={m}
              type="button"
              className={`pill ${stay === m ? 'on' : ''}`}
              aria-pressed={stay === m}
              onClick={() => act.stay(k, m)}
            >
              {m ? t('minutes', { n: m }) : t('changeHere')}
            </button>
          ))}
        </div>
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
      <div className="acts">
        <button type="button" className="pill" onClick={() => act.addAfter(k)}>
          <Icon name="plus" size={16} />
          {t('addAfter')}
        </button>
        <span className="sp" />
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
