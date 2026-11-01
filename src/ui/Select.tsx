import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

export interface Option<V extends string> {
  value: V;
  label: ReactNode;
}

/**
 * A select in the app's own style: a button that opens a listbox under it (WAI-ARIA
 * select-only combobox). Arrow keys, Home/End and Enter work as in a native select; the popup
 * keeps focus on the button, so a surrounding edit field does not lose it.
 */
export function Select<V extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  /** Accessible name (shown to screen readers only). */
  label: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(current);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(`#${CSS.escape(`${id}-${active}`)}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);

  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    setOpen(false);
  };
  const show = () => {
    setActive(current);
    setOpen(true);
  };

  return (
    <div className={`select ${className}`} ref={root}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          const last = options.length - 1;
          if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) show();
            else return;
          } else if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, last));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Home') setActive(0);
          else if (e.key === 'End') setActive(last);
          else if (e.key === 'Enter' || e.key === ' ') choose(active);
          else if (e.key === 'Escape' || e.key === 'Tab') {
            setOpen(false);
            if (e.key === 'Tab') return;
          } else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="select-value">{options[current]?.label}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="select-list">
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : ''}
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {o.label}
              {o.value === value && <Icon name="check" size={16} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
