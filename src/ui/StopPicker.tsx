import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Stop, StopMode, StopSearch } from '../core/stops';
import type { MessageKey } from '../i18n';
import { stopSearch } from '../io/stops';
import { useT } from '../store';
import { Icon } from './icons';

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

/**
 * Station search as an ARIA combobox over the bundled stop index. As an edit field
 * (`initial` given) it starts with the station's name selected, has a clear button, and reports
 * the text left when focus leaves it and anything in `trailing` (`onLeave`).
 */
export function StopPicker({
  onPick,
  label,
  autoFocus,
  initial,
  onLeave,
  onCancel,
  trailing,
}: {
  onPick: (s: Stop) => void;
  label: string;
  autoFocus?: boolean;
  initial?: string;
  onLeave?: (text: string) => void;
  onCancel?: () => void;
  trailing?: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [index, setIndex] = useState<StopSearch | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState(initial ?? '');
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);

  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    stopSearch().then(setIndex, () => setFailed(true));
  }, []);
  // The field is disabled until the index is there, so focus it then (autoFocus alone misses).
  useEffect(() => {
    if (autoFocus && index) input.current?.focus();
  }, [autoFocus, index]);

  // An unchanged name searches nothing: the list opens once you type.
  const query = text === initial || closed ? '' : text.trim();
  const hits = index && query.length >= 2 ? index.search(query, 8) : [];
  const listOpen = !!index && query.length >= 2;
  const pick = (s: Stop) => {
    onPick(s);
    setText('');
    setActive(0);
  };

  return (
    <div
      className={`picker ${initial !== undefined ? 'editing' : ''}`}
      onBlur={(e) => {
        if (!onLeave || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onLeave(text.trim());
      }}
    >
      <label htmlFor={`${id}-in`} className="sr-only">
        {label}
      </label>
      <input
        ref={input}
        id={`${id}-in`}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={`${id}-list`}
        aria-activedescendant={hits.length ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={(e) => initial !== undefined && e.target.select()}
        value={text}
        placeholder={index ? label : failed ? t('stopsFailed') : t('stopsLoading')}
        disabled={!index}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setClosed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && listOpen) {
            e.preventDefault();
            return setClosed(true);
          }
          if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            return onCancel();
          }
          if (e.key === 'ArrowDown' && closed) {
            e.preventDefault();
            return setClosed(false);
          }
          // Enter with no station found keeps the field and its text (nothing to pick yet);
          // on the unchanged name or an empty field it leaves.
          if (e.key === 'Enter' && onLeave && !hits.length) {
            e.preventDefault();
            if (text.trim() && text !== initial && listOpen) return;
            return onLeave(text.trim());
          }
          if (!hits.length) return;
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') pick(hits[active]!);
          else return;
          e.preventDefault();
        }}
      />
      {initial !== undefined && text && (
        <button
          type="button"
          className="icon clear"
          aria-label={t('clear')}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            setText('');
            setActive(0);
            // The button goes away with the text: keep the focus in the field.
            input.current?.focus();
          }}
        >
          <Icon name="close" size={18} />
        </button>
      )}
      {trailing}
      {listOpen && (
        <ul id={`${id}-list`} role="listbox" className="options">
          {hits.length === 0 && (
            <li className="muted" role="option" aria-selected={false} aria-disabled="true">
              {t('noStops')}
            </li>
          )}
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
