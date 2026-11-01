import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LiveRide, LiveState } from '../core/live';
import type { Connection, Section } from '../core/model';
import type { PlannedChain } from '../core/planner/plan';
import type { Warning } from '../core/warnings';
import { usePrefs, useT } from '../store';
import { duration, hhmm, minutesBetween } from './format';
import { TEMPLATES } from './TemplatePicker';

/** "R62", "IC3"; numeric lines with their category: "CC 63" (cog), "PB 2461" (cable car). */
export const badge = (s: Section) =>
  s.line && /[A-Za-z]/.test(s.line)
    ? s.line
    : [s.category, s.line ?? s.number].filter(Boolean).join(' ');

const SEVERITY: Record<Warning['severity'], string> = {
  error: 'warn-red',
  warn: 'warn-amber',
  info: '',
};

function Warnings({ list }: { list: Warning[] }) {
  const t = useT();
  const lang = usePrefs((s) => s.lang);
  if (!list.length) return null;
  return (
    <ul className="warns">
      {list.map((w, i) => (
        <li key={i} className={`warn ${SEVERITY[w.severity]}`}>
          {w.type === 'seasonal'
            ? (TEMPLATES.find((x) => x.id === w.params.template)?.season?.note[lang] ??
              t(w.key, w.params))
            : t(w.key, w.params)}
        </li>
      ))}
    </ul>
  );
}

/** A time as expected, with "+N" when late (live view only). */
function When({ plan, live }: { plan?: string; live?: number }) {
  if (!plan) return null;
  const planned = Date.parse(plan);
  const late = live !== undefined ? Math.round((live - planned) / 60_000) : 0;
  return (
    <time>
      {hhmm(live ?? planned)}
      {late > 0 && <span className="late"> +{late}</span>}
    </time>
  );
}

/** A connection as rows on the rail: stations (arrival over departure at a change) and rides. */
type Row =
  | {
      kind: 'station';
      name: string;
      arr?: string;
      dep?: string;
      platform?: string;
      arrRide?: number;
      depRide?: number;
    }
  | { kind: 'ride'; s: Section; index: number }
  | { kind: 'walk'; min: number };

function rowsOf(c: Connection): Row[] {
  const rows: Row[] = [];
  c.sections.forEach((s, index) => {
    if (s.mode === 'walk') return;
    const last = rows.at(-1);
    if (last?.kind === 'station' && last.name === s.from.name) {
      last.dep = s.from.dep;
      last.depRide = index;
      last.platform = s.from.platform ?? last.platform;
    } else {
      if (last?.kind === 'station' && last.arr && s.from.dep)
        rows.push({ kind: 'walk', min: minutesBetween(last.arr, s.from.dep) });
      rows.push({
        kind: 'station',
        name: s.from.name,
        dep: s.from.dep,
        platform: s.from.platform,
        depRide: index,
      });
    }
    rows.push({ kind: 'ride', s, index });
    rows.push({
      kind: 'station',
      name: s.to.name,
      arr: s.to.arr,
      platform: s.to.platform,
      arrRide: index,
    });
  });
  return rows;
}

/**
 * With a ride's stops open, puts the marker (and the grey/blue split of the rail) where the
 * train is between the two stops shown, measured from the laid-out list.
 */
function SyncHere({ i, fraction }: { i: number; fraction: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = ref.current?.closest<HTMLElement>('.row');
    const rail = row?.querySelector<HTMLElement>(':scope > .rail');
    if (!row || !rail) return;
    const place = () => {
      const top = rail.getBoundingClientRect().top;
      const mids = [...row.querySelectorAll<HTMLElement>('.mids > li:not(.here-mid)')];
      // Points along the rail: the departure (row top), each stop between, the arrival (row end).
      const points = [
        0,
        ...mids.map((li) => {
          const r = li.getBoundingClientRect();
          return r.top + r.height / 2 - top;
        }),
        rail.getBoundingClientRect().height,
      ];
      const a = points[Math.min(i, points.length - 1)]!;
      const b = points[Math.min(i + 1, points.length - 1)]!;
      row.style.setProperty('--f', `${(a + (b - a) * fraction).toFixed(1)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(row);
    return () => {
      ro.disconnect();
      row.style.removeProperty('--f');
    };
  }, [i, fraction]);
  return <span ref={ref} hidden />;
}

function HereMid() {
  const t = useT();
  return (
    <li className="here-mid">
      <span className="sr-only">{t('youAreHere')}</span>
    </li>
  );
}

interface LiveCtx {
  state: LiveState;
  now: number;
}

function Leg({
  c,
  leg,
  warnings,
  live,
}: {
  c: Connection;
  leg: number;
  warnings: Warning[];
  live?: LiveCtx;
}) {
  const t = useT();
  const rows = rowsOf(c);
  const rideOf = (section?: number): LiveRide | undefined =>
    section === undefined
      ? undefined
      : live?.state.rides.find((r) => r.leg === leg && r.section === section);
  const current = live ? live.state.rides[live.state.current] : undefined;
  const isCurrent = (section: number) => current?.leg === leg && current.section === section;
  // A tap decides; until then the ride being travelled shows its stops, the others don't.
  const [toggled, setToggled] = useState<Map<number, boolean>>(new Map());
  const isOpen = (section: number) =>
    toggled.get(section) ?? (live?.state.phase === 'riding' && isCurrent(section));
  const toggle = (section: number) => setToggled((m) => new Map(m).set(section, !isOpen(section)));

  return (
    <ol>
      {rows.map((r, i) => {
        const pos = `${i === 0 ? 'first' : ''} ${i === rows.length - 1 ? 'last' : ''}`;
        if (r.kind === 'station') {
          const arrLive = rideOf(r.arrRide)?.stops.at(-1);
          const depLive = rideOf(r.depRide)?.stops[0];
          const t0 = depLive?.dep ?? arrLive?.arr ?? Date.parse(r.dep ?? r.arr ?? '');
          const passed =
            live &&
            t0 <= live.now &&
            !(r.depRide !== undefined && isCurrent(r.depRide) && live.state.phase !== 'riding');
          const here =
            live &&
            r.depRide !== undefined &&
            isCurrent(r.depRide) &&
            live.state.phase !== 'riding';
          return (
            <li
              key={i}
              className={`row station ${pos} ${i === 0 || i === rows.length - 1 ? 'end' : ''} ${passed ? 'passed' : ''} ${here ? 'here' : ''}`}
            >
              <span className="times-col">
                <When plan={r.arr} live={arrLive?.arr} />
                <When plan={r.dep} live={depLive?.dep} />
              </span>
              <span className="rail" />
              <span className="what">
                <b>{r.name}</b>
                {(depLive?.platform ?? r.platform) && (
                  <span className="plat">
                    {t('platform', { p: depLive?.platform ?? r.platform ?? '' })}
                  </span>
                )}
              </span>
            </li>
          );
        }
        if (r.kind === 'walk')
          return (
            <li key={i} className={`row walk ${pos}`}>
              <span />
              <span className="rail" />
              <span className="what">
                {t('walk')} {r.min > 0 && `${r.min}′`}
              </span>
            </li>
          );
        const own = warnings.filter((w) => w.sectionIndex === r.index);
        const lr = rideOf(r.index);
        const riding = live?.state.phase === 'riding' && isCurrent(r.index);
        const dep = lr?.stops[0]?.dep;
        const arr = lr?.stops.at(-1)?.arr;
        const f =
          riding && dep && arr
            ? Math.min(1, Math.max(0, (live!.now - dep) / Math.max(1, arr - dep)))
            : 0;
        const passed = live && arr !== undefined && arr <= live.now;
        const mids = r.s.intermediate;
        const shown = isOpen(r.index);
        return (
          <li
            key={i}
            className={`row ride ${pos} ${riding ? 'here' : ''} ${shown ? 'with-mids' : ''} ${passed ? 'passed' : ''}`}
            style={riding ? ({ '--f': `${(f * 100).toFixed(1)}%` } as CSSProperties) : undefined}
          >
            <span />
            <span className="rail" />
            <span className="what">
              <span className="line-info">
                <span className="badge">{badge(r.s)}</span>
                {mids.length > 0 ? (
                  <button
                    type="button"
                    className="mids-toggle"
                    aria-expanded={shown}
                    onClick={() => toggle(r.index)}
                  >
                    {mids.length === 1 ? t('stop1') : t('stopsBetween', { n: mids.length })}
                  </button>
                ) : null}
                {r.s.from.dep && r.s.to.arr && (
                  <span>· {duration(minutesBetween(r.s.from.dep, r.s.to.arr))}</span>
                )}
              </span>
              {shown && (
                <ol className="mids">
                  {mids.flatMap((m, k) => {
                    const ls = lr?.stops[k + 1];
                    const when = ls?.dep ?? ls?.arr;
                    const item = (
                      <li
                        key={k}
                        className={live && when !== undefined && when <= live.now ? 'passed' : ''}
                      >
                        <When plan={m.dep ?? m.arr} live={when} />
                        <span>{m.name}</span>
                      </li>
                    );
                    // Between stops[j] and stops[j+1]: the marker goes just before stop j (mids[k = j]).
                    return riding && live!.state.between?.i === k
                      ? [<HereMid key="here" />, item]
                      : [item];
                  })}
                  {riding && live!.state.between?.i === mids.length && <HereMid />}
                </ol>
              )}
              <Warnings list={own} />
              {riding && shown && live!.state.between && (
                <SyncHere i={live!.state.between.i} fraction={live!.state.between.fraction} />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ChainView({
  chain,
  dwell,
  live,
}: {
  chain: PlannedChain;
  dwell: number[];
  live?: LiveCtx;
}) {
  const t = useT();
  return (
    <ol className={`chain ${live ? 'live' : ''}`}>
      {chain.connections.map((c, leg) => {
        const own = chain.warnings.filter((w) => w.legIndex === leg);
        const next = chain.connections[leg + 1];
        const at = c.sections.at(-1)!.to.name;
        return (
          <li key={leg} className="leg">
            <h3>
              {c.sections[0]!.from.name} → {at} · {duration(minutesBetween(c.dep, c.arr))} ·{' '}
              {c.transfers === 1 ? t('transfer1') : t('transfers', { n: c.transfers })}
            </h3>
            <Leg c={c} leg={leg} warnings={own} live={live} />
            {own.some((w) => w.sectionIndex === undefined) && (
              <div className="row">
                <span />
                <span />
                <Warnings list={own.filter((w) => w.sectionIndex === undefined)} />
              </div>
            )}
            {next && (
              <div className="stay">
                <span />
                <span className="rail" />
                <span className="what">
                  {t('stayAt', { min: duration(minutesBetween(c.arr, next.dep)), at })}
                  {(dwell[leg] ?? 0) > 0 && minutesBetween(c.arr, next.dep) > dwell[leg]! + 10 && (
                    <span className="muted"> · {t('planned', { min: duration(dwell[leg]!) })}</span>
                  )}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
