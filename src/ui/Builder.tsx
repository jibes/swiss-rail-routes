import { useEffect, useState } from 'react';
import {
  addWaypoint,
  insertTemplate,
  moveWaypoint,
  removeWaypoint,
  replaceWaypoint,
  setStay,
  setRoundTrip,
} from '../core/edit';
import type { Tour } from '../core/model';
import type { StopSearch } from '../core/stops';
import { stopKey } from '../core/stops';
import { expandLegs, isRoundTrip, totalDwellMin } from '../core/tour';
import { stopSearch } from '../io/stops';
import { useT } from '../store';
import { useTours } from '../tours';
import { Icon } from './icons';
import { StopPicker } from './StopPicker';
import { dwellLabel, StopRow } from './StopRow';
import { directionFrom, TEMPLATES, TemplatePicker } from './TemplatePicker';
import { useDragList } from './useDragList';
import { go } from './useHash';
import { autoName } from '../core/naming';
import { shareLink } from './share';
import { routeHash, tourHash } from '../core/export/routeLink';

export function Builder({ id, showTemplates }: { id: string; showTemplates?: boolean }) {
  const t = useT();
  const tour = useTours((s) => s.tours.find((x) => x.id === id));
  const update = useTours((s) => s.update);
  const remove = useTours((s) => s.remove);
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

  useAddress(tour, showTemplates ? '/templates' : '');

  if (!tour) return <NotFound />;
  const edit = (f: (x: Tour) => Tour) => update(id, f);
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
          placeholder={autoName(tour, stop) || t('untitled')}
          value={tour.name}
          onChange={(e) => edit((x) => ({ ...x, name: e.target.value }))}
        />
        <button
          type="button"
          className="icon"
          aria-label={t('shareRoute')}
          disabled={wps.length < 2}
          onClick={() => void shareLink(routeHash(tour), tour.name || t('untitled'))}
        >
          <Icon name="share" />
        </button>
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
                last={i === wps.length - 1}
                caption={runStart ? TEMPLATES.find((x) => x.id === w.templateId)?.name : undefined}
                onStay={(m) => edit((x) => setStay(x, i, m))}
                onRemove={() => {
                  edit((x) => removeWaypoint(x, i));
                }}
                onReplace={(stop) => edit((x) => replaceWaypoint(x, i, stop))}
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
            {legs > 0 && (legs === 1 ? t('legs1') : t('legsCount', { n: legs }))}
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

/**
 * Keeps the address bar a share link: `#/tour/<id><sub>?s=…` follows every edit (replacing the
 * history entry, so back still leaves the screen).
 */
export function useAddress(tour: Tour | undefined, sub: string) {
  useEffect(() => {
    if (!tour || tour.waypoints.length < 2) return;
    const path = `#/tour/${tour.id}${sub}`;
    if (location.hash.split('?')[0] !== path) return;
    const next = tourHash(tour, sub);
    if (location.hash !== next) history.replaceState(history.state, '', next);
  }, [tour, sub]);
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
