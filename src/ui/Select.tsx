import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLayer } from './layers';
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
  keepFocus = false,
}: {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  /** Accessible name (shown to screen readers only). */
  label: string;
  className?: string;
  /**
   * Inside an edit field: a tap must not take the focus from the field (Safari gives none to
   * tapped buttons and the field would close before the list opens).
   */
  keepFocus?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(current);
  // Near the bottom of the screen the list opens upwards, clear of the dock.
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // Android's Back closes the open list first, as any layer on top.
  useLayer(open, close);

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
    const r = root.current?.getBoundingClientRect();
    setUp(!!r && r.bottom + 340 > window.innerHeight && r.top > 340);
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
        onPointerDown={keepFocus ? (e) => e.preventDefault() : undefined}
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
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={`select-list ${up ? 'up' : ''}`}
        >
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
