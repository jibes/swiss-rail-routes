// One row's piece of the weather stripe (0.37.0): the sky's colour fading into the next row's,
// and a bar from the right as wide as the chance of rain or snow (none under RAIN_MIN). A tap says
// its values, the forecast's time and whose it is; the same words for screen readers.
import { useEffect, useRef, useState } from 'react';
import { RAIN_MIN, skyColour, skyKind, tempText, type Sky } from '../core/weather';
import { useT } from '../store';
import { hhmm } from './format';

type T = ReturnType<typeof useT>;

/** What a piece of weather says, on the line and on the map: the same words in both. */
export function weatherWords(
  t: T,
  w: Sky,
  where: string,
  when: string | undefined,
  source: 'open-meteo' | 'met.no',
  at: number,
  along = false,
) {
  const sky = t(
    ({ sun: 'wxSunny', part: 'wxSomeSun', cloud: 'wxCloudy', night: 'wxNight' } as const)[
      skyKind(w)
    ],
  );
  const n = Math.round(w.rain * 100);
  const rain = w.rain >= RAIN_MIN ? t(along ? 'wxRainAlong' : 'wxRain', { n }) : '';
  const title = when ? `${where} ${hhmm(when)}` : where;
  return {
    title,
    label: [title, rain || sky].join(': '),
    detail: [
      [sky, w.temp !== undefined ? tempText(w.temp) : '', rain].filter(Boolean).join(' · '),
      t(source === 'met.no' ? 'wxByMet' : 'wxByMeteo', { time: hhmm(new Date(at).toISOString()) }),
    ],
  };
}

export function WeatherCell({
  w,
  next,
  where,
  when,
  source,
  at,
  mid,
  along,
}: {
  w: Sky | undefined;
  /** The next row's sky: this one fades into it. */
  next?: Sky;
  where: string;
  /** When you are there, ISO. */
  when?: string;
  source: 'open-meteo' | 'met.no';
  /** When the forecast was asked (ms). */
  at: number;
  /** A stop inside a ride: a bar only, beside its name. */
  mid?: boolean;
  /** A ride: its rain is the highest along the way, said so; no bar while its stops show theirs. */
  along?: { open: boolean };
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const me = useRef<HTMLButtonElement>(null);
  // A tap anywhere else closes it: Safari gives a tapped button no focus, so no blur came
  // (review of 11 Nov 2026: the card stayed until tapped again).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!me.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  if (!w) return mid ? null : <span className="wx-cell" aria-hidden="true" />;
  const { title, label, detail } = weatherWords(t, w, where, when, source, at, !!along);
  const bar = w.rain >= RAIN_MIN && !along?.open && (
    <span
      className={`wx-bar ${w.day ? '' : 'night'}`}
      style={{ width: `${Math.round(w.rain * 100)}%` }}
    />
  );
  return (
    <button
      ref={me}
      type="button"
      className={mid ? 'wx-mid' : 'wx-cell'}
      style={
        mid
          ? undefined
          : { background: `linear-gradient(${skyColour(w)}, ${skyColour(next ?? w)})` }
      }
      aria-label={label}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      onBlur={() => setOpen(false)}
    >
      {bar}
      {open && (
        <span className="wx-tip" role="status">
          <b>{title}</b>
          {detail.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * What the stripe at the right is (review of 11 Nov 2026: a first-time eye did not know): its
 * name over it, and a tap says how to read it.
 */
export function WeatherKey() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="wx-key">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('wxKey')}
      </button>
      {open && <p className="wx-key-text">{t('wxKeyText')}</p>}
    </div>
  );
}
