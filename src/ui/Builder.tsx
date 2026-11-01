import { useState } from 'react';
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
import { expandLegs, isRoundTrip, totalDwellMin } from '../core/tour';
import { useT } from '../store';
import { useTours } from '../tours';
import { StopPicker } from './StopPicker';
import { TemplatePicker } from './TemplatePicker';
import { WaypointRow } from './WaypointRow';
import { go } from './useHash';

const TICKETS: [TicketType, 'ticketGA' | 'ticketDay' | 'ticketHalf' | 'ticketNone'][] = [
  ['GA', 'ticketGA'],
  ['Tageskarte', 'ticketDay'],
  ['Halbtax', 'ticketHalf'],
  ['none', 'ticketNone'],
];

export function Builder({ id, showTemplates }: { id: string; showTemplates?: boolean }) {
  const t = useT();
  const tour = useTours((s) => s.tours.find((x) => x.id === id));
  const update = useTours((s) => s.update);
  const remove = useTours((s) => s.remove);
  const [templates, setTemplates] = useState(!!showTemplates);
  const [confirm, setConfirm] = useState(false);

  if (!tour) return <NotFound />;
  const edit = (f: (x: Tour) => Tour) => update(id, f);
  const departs = 'departAt' in tour.anchor;
  const time = 'departAt' in tour.anchor ? tour.anchor.departAt : tour.anchor.arriveBy;
  const legs = expandLegs(tour).length;

  return (
    <main className="page builder">
      <header className="bar">
        <button type="button" onClick={() => go('/')}>
          ← {t('back')}
        </button>
        <h1>{tour.name || t('untitled')}</h1>
        <button
          type="button"
          disabled={!tour.waypoints.length}
          onClick={() => go(`/tour/${id}/map`)}
        >
          {t('map')}
        </button>
      </header>

      <div className="fields">
        <label>
          {t('tourName')}
          <input
            value={tour.name}
            placeholder={t('untitled')}
            onChange={(e) => edit((x) => ({ ...x, name: e.target.value }))}
          />
        </label>
        <label>
          {t('date')}
          <input
            type="date"
            value={tour.date}
            onChange={(e) => e.target.value && edit((x) => ({ ...x, date: e.target.value }))}
          />
        </label>
        <div className="row">
          <label>
            <span className="sr-only">{t('anchor')}</span>
            <select
              value={departs ? 'dep' : 'arr'}
              onChange={(e) =>
                edit((x) => ({
                  ...x,
                  anchor: e.target.value === 'dep' ? { departAt: time } : { arriveBy: time },
                }))
              }
            >
              <option value="dep">{t('departAt')}</option>
              <option value="arr">{t('arriveBy')}</option>
            </select>
          </label>
          <label>
            <span className="sr-only">{t('time')}</span>
            <input
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
        </div>
        <label>
          {t('ticket')}
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
        <label className="switch">
          <input
            type="checkbox"
            checked={isRoundTrip(tour)}
            disabled={tour.waypoints.length < 2}
            onChange={(e) => edit((x) => setRoundTrip(x, e.target.checked))}
          />{' '}
          {t('roundTrip')}
        </label>
      </div>

      <ol className="waypoints" aria-label={t('stops')}>
        {tour.waypoints.map((w, i) => (
          <WaypointRow
            key={`${i}-${w.stopRef}`}
            w={w}
            index={i}
            count={tour.waypoints.length}
            onStop={(on) => edit((x) => setStop(x, i, on))}
            onDwell={(m) => edit((x) => setDwell(x, i, m))}
            onMove={(to) => edit((x) => moveWaypoint(x, i, to))}
            onRemove={() => edit((x) => removeWaypoint(x, i))}
          />
        ))}
      </ol>

      <StopPicker
        label={tour.waypoints.length ? t('addStop') : t('startStation')}
        onPick={(s) => edit((x) => addWaypoint(x, { stopRef: s.ref, name: s.name }))}
      />

      <button type="button" aria-expanded={templates} onClick={() => setTemplates((v) => !v)}>
        {t('addRoute')}
      </button>
      {templates && (
        <TemplatePicker
          month={Number(tour.date.slice(5, 7))}
          onPick={(tp, rev) => {
            edit((x) => insertTemplate(x, tp, rev));
            setTemplates(false);
          }}
        />
      )}

      <footer className="sticky">
        <span className="muted">
          {t('legsCount', { n: legs })} · {t('dwellTotal', { min: totalDwellMin(tour) })}
        </span>
        <button
          type="button"
          className="primary"
          disabled={legs === 0}
          onClick={() => go(`/tour/${id}/plan`)}
        >
          {t('plan')}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (!confirm) return setConfirm(true);
            remove(id);
            go('/');
          }}
        >
          {confirm ? t('confirmDelete') : t('deleteTour')}
        </button>
      </footer>
    </main>
  );
}

export function NotFound() {
  const t = useT();
  return (
    <main className="page">
      <p>{t('notFound')}</p>
      <button type="button" onClick={() => go('/')}>
        {t('back')}
      </button>
    </main>
  );
}
