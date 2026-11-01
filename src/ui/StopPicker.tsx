import { useEffect, useId, useState } from 'react';
import type { Stop, StopMode, StopSearch } from '../core/stops';
import type { MessageKey } from '../i18n';
import { stopSearch } from '../io/stops';
import { useT } from '../store';

const MODE_KEY: Partial<Record<StopMode, MessageKey>> = {
  RACK_RAILWAY: 'modeRack',
  CABLE_RAILWAY: 'modeFunicular',
  CABLE_CAR: 'modeCableCar',
  CHAIRLIFT: 'modeChairlift',
  BOAT: 'modeBoat',
  TRAM: 'modeTram',
  METRO: 'modeMetro',
  BUS: 'modeBus',
  ELEVATOR: 'modeLift',
};

/** Station search as an ARIA combobox over the bundled stop index. */
export function StopPicker({ onPick, label }: { onPick: (s: Stop) => void; label: string }) {
  const t = useT();
  const id = useId();
  const [index, setIndex] = useState<StopSearch | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    stopSearch().then(setIndex, () => setFailed(true));
  }, []);

  const hits = index && text.trim().length >= 2 ? index.search(text, 8) : [];
  const pick = (s: Stop) => {
    onPick(s);
    setText('');
    setActive(0);
  };

  return (
    <div className="picker">
      <label htmlFor={`${id}-in`}>{label}</label>
      <input
        id={`${id}-in`}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={hits.length ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder={index ? t('searchStop') : failed ? t('stopsFailed') : t('stopsLoading')}
        disabled={!index}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!hits.length) return;
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') pick(hits[active]!);
          else if (e.key === 'Escape') setText('');
          else return;
          e.preventDefault();
        }}
      />
      {text.trim().length >= 2 && index && (
        <ul id={`${id}-list`} role="listbox" className="options">
          {hits.length === 0 && <li className="muted">{t('noStops')}</li>}
          {hits.map((s, i) => (
            <li
              key={s.ref}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              {s.name}
              {!s.modes.includes('TRAIN') && MODE_KEY[s.modes[0]!] && (
                <span className="muted"> · {t(MODE_KEY[s.modes[0]!]!)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
