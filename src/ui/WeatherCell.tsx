// One row's piece of the weather stripe (0.37.0): the sky's colour fading into the next row's,
// and a bar from the right as wide as the chance of rain or snow (none under RAIN_MIN). A tap says
// its values, the forecast's time and whose it is; the same words for screen readers.
import { useState } from 'react';
import { RAIN_MIN, skyColour, type Sky } from '../core/weather';
import { useT } from '../store';
import { hhmm } from './format';

export function WeatherCell({
  w,
  next,
  where,
  when,
  source,
  at,
  mid,
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
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!w) return mid ? null : <span className="wx-cell" aria-hidden="true" />;
  const sky = w.day
    ? t(w.cloud >= 0.7 ? 'wxCloudy' : w.cloud >= 0.3 ? 'wxSomeSun' : 'wxSunny')
    : t('wxNight');
  const rain = Math.round(w.rain * 100);
  const label = [
    when ? `${where} ${hhmm(when)}` : where,
    w.rain >= RAIN_MIN ? t('wxRain', { n: rain }) : sky,
  ].join(': ');
  const detail = [
    `${sky}${w.rain >= RAIN_MIN ? ` · ${t('wxRain', { n: rain })}` : ''}`,
    t(source === 'met.no' ? 'wxByMet' : 'wxByMeteo', { time: hhmm(new Date(at).toISOString()) }),
  ];
  const bar = w.rain >= RAIN_MIN && (
    <span
      className={`wx-bar ${w.day ? '' : 'night'}`}
      style={{ width: `${Math.round(w.rain * 100)}%` }}
    />
  );
  return (
    <button
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
          <b>{when ? `${where} ${hhmm(when)}` : where}</b>
          {detail.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </span>
      )}
    </button>
  );
}
