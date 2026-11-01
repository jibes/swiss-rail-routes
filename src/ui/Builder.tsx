import { useEffect, useState } from 'react';
import {
  addWaypoint,
  insertTemplate,
  moveWaypoint,
  removeWaypoint,
  setDwell,
  setRoundTrip,
  setStop,
} from '../core/edit';
import type { TicketType, Tour } from '../core/model';
import type { StopSearch } from '../core/stops';
import { stopKey } from '../core/stops';
import { expandLegs, isRoundTrip, totalDwellMin } from '../core/tour';
import { stopSearch } from '../io/stops';
import { usePrefs, useT } from '../store';
import { useTours } from '../tours';
import { shortDate } from './format';
import { Icon } from './icons';
import { StopPicker } from './StopPicker';
import { dwellLabel, StopRow } from './StopRow';
import { directionFrom, TEMPLATES, TemplatePicker } from './TemplatePicker';
import { useDragList } from './useDragList';
import { go } from './useHash';

const TICKETS: [TicketType, 'ticketGA' | 'ticketDay' | 'ticketHalf' | 'ticketNone'][] = [
  ['GA', 'ticketGA'],
  ['Tageskarte', 'ticketDay'],
  ['Halbtax', 'ticketHalf'],
  ['none', 'ticketNone'],
];

export function Builder({ id, showTemplates }: { id: string; showTemplates?: boolean }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  const tour = useTours((s) => s.tours.find((x) => x.id === id));
  const update = useTours((s) => s.update);
  const remove = useTours((s) => s.remove);
  const [open, setOpen] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [index, setIndex] = useState<StopSearch | null>(null);
  // A new object per move, so moving to the same index twice still refocuses.
  const [focusGrip, setFocusGrip] = useState<{ i: number } | null>(null);
  const {
    listRef,
    list: listEl,
    grip,
    rowStyle,
    dragging,
  } = useDragList((from, to) => {
    update(id, (x) => moveWaypoint(x, from, to));
    setOpen(null);
    setFocusGrip({ i: to });
  });

  useEffect(() => {
    stopSearch().then(setIndex, () => undefined);
  }, []);
  // Keyboard moves keep the focus on the moved station's grip.
  useEffect(() => {
    if (focusGrip === null) return;
    listEl?.querySelector<HTMLElement>(`[data-grip="${focusGrip.i}"]`)?.focus();
  }, [focusGrip, listEl]);
  useEffect(() => {
    if (showTemplates) document.getElementById('routes')?.scrollIntoView({ block: 'center' });
  }, [showTemplates]);

  if (!tour) return <NotFound />;
  const edit = (f: (x: Tour) => Tour) => update(id, f);
  const departs = 'departAt' in tour.anchor;
  const time = 'departAt' in tour.anchor ? tour.anchor.departAt : tour.anchor.arriveBy;
  const legs = expandLegs(tour).length;
  const closed = isRoundTrip(tour);
  const wps = tour.waypoints;
  // Where the next stop or route attaches: before the return in a round trip.
  const tail = wps[closed ? wps.length - 2 : wps.length - 1];
  const stop = (ref: string) => index?.byRef(stopKey(ref));
  const dwell = totalDwellMin(tour);

  return (
    <main className="page builder">
      <header className="bar">
        <button type="button" className="icon" aria-label={t('back')} onClick={() => go('/')}>
          <Icon name="back" />
        </button>
        <input
          className="title"
          aria-label={t('tourName')}
          placeholder={t('untitled')}
          value={tour.name}
          onChange={(e) => edit((x) => ({ ...x, name: e.target.value }))}
        />
        <button
          type="button"
          className="icon"
          aria-label={t('map')}
          disabled={wps.length < 2}
          onClick={() => go(`/tour/${id}/map`)}
        >
          <Icon name="map" />
        </button>
      </header>

      <div className="strip">
        <label className="pill picker-pill">
          <span aria-hidden="true">{shortDate(tour.date, lang)}</span>
          <input
            aria-label={t('date')}
            type="date"
            value={tour.date}
            onChange={(e) => e.target.value && edit((x) => ({ ...x, date: e.target.value }))}
          />
        </label>
        <span className="pill">
          <span className="seg" role="group" aria-label={t('anchor')}>
            <button
              type="button"
              aria-pressed={departs}
              onClick={() => edit((x) => ({ ...x, anchor: { departAt: time } }))}
            >
              {t('departAt')}
            </button>
            <button
              type="button"
              aria-pressed={!departs}
              onClick={() => edit((x) => ({ ...x, anchor: { arriveBy: time } }))}
            >
              {t('arriveBy')}
            </button>
          </span>
          <label className="picker-pill time-pill">
            <span aria-hidden="true" className="num">
              {time}
            </span>
            <input
              aria-label={t('time')}
              type="time"
              value={time}
              onChange={(e) =>
                e.target.value &&
                edit((x) => ({
                  ...x,
                  anchor: departs ? { departAt: e.target.value } : { arriveBy: e.target.value },
                }))
              }
            />
          </label>
        </span>
        <label className="pill">
          <span className="sr-only">{t('ticket')}</span>
          <select
            value={tour.ticket}
            onChange={(e) => edit((x) => ({ ...x, ticket: e.target.value as TicketType }))}
          >
            {TICKETS.map(([v, k]) => (
              <option key={v} value={v}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="pill toggle-pill">
          <input
            type="checkbox"
            checked={closed}
            disabled={wps.length < 2}
            onChange={(e) => edit((x) => setRoundTrip(x, e.target.checked))}
          />
          <Icon name="loop" size={18} />
          {t('roundTrip')}
        </label>
      </div>

      <div>
        <ol className="line" aria-label={t('stops')} ref={listRef}>
          {wps.map((w, i) => {
            const runStart = w.templateId && wps[i - 1]?.templateId !== w.templateId;
            return (
              <StopRow
                key={`${i}-${w.stopRef}`}
                w={w}
                index={i}
                count={wps.length}
                last={i === wps.length - 1}
                caption={runStart ? TEMPLATES.find((x) => x.id === w.templateId)?.name : undefined}
                open={open === i}
                onToggle={() => setOpen(open === i ? null : i)}
                onStop={(on) => edit((x) => setStop(x, i, on))}
                onDwell={(m) => edit((x) => setDwell(x, i, m))}
                onMove={(to) => {
                  edit((x) => moveWaypoint(x, i, to));
                  setOpen(to);
                }}
                onRemove={() => {
                  edit((x) => removeWaypoint(x, i));
                  setOpen(null);
                }}
                grip={grip(i)}
                style={rowStyle(i)}
                dragging={dragging === i}
              />
            );
          })}
        </ol>
        <div className={`stop add ${wps.length ? '' : 'first'}`}>
          <span className="dot" aria-hidden="true" />
          <StopPicker
            label={wps.length ? t('addStop') : t('startStation')}
            onPick={(s) => edit((x) => addWaypoint(x, { stopRef: s.ref, name: s.name }))}
          />
        </div>
      </div>

      <TemplatePicker
        reversedFor={(tp) => directionFrom(tp, tail && stop(tail.stopRef), stop)}
        onPick={(tp, rev) => edit((x) => insertTemplate(x, tp, rev))}
      />

      <button
        type="button"
        className={`text-button ${confirm ? 'danger' : ''}`}
        onClick={() => {
          if (!confirm) return setConfirm(true);
          remove(id);
          go('/');
        }}
      >
        {confirm ? t('confirmDelete') : t('deleteTour')}
      </button>

      <div className="dock">
        <div className="dock-inner">
          <span className="note">
            {legs > 0 && t('legsCount', { n: legs })}
            {dwell > 0 && ` · ${dwellLabel(dwell)}`}
          </span>
          <button
            type="button"
            className="primary"
            disabled={legs === 0}
            onClick={() => go(`/tour/${id}/plan`)}
          >
            {t('plan')}
          </button>
        </div>
      </div>
    </main>
  );
}

export function NotFound() {
  const t = useT();
  return (
    <main className="page">
      <p>{t('notFound')}</p>
      <button type="button" className="secondary" onClick={() => go('/')}>
        {t('back')}
      </button>
    </main>
  );
}
