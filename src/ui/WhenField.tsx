import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

/** Long enough for the next digit, or the next stop of a wheel. */
const QUIET_MS = 600;

/**
 * A native date or time field dressed as a pill: the pill says the value our way (the app's
 * language, 24 hours, the weekday) and the field lies invisible over it, so the system's own
 * picker, keyboard and screen reader do the rest.
 *
 * A field reports every step on the way (typing 14:30 passes 01:05 and 14:05, an iOS wheel every
 * stop), so what it says stays here until it rests. `accept` gives the value it stands for, null
 * if none. Keys typed are held while that is another value, until the field is left or Enter is
 * pressed: the next digit may still put it right.
 */
export function WhenField({
  type,
  label,
  value,
  min,
  accept,
  commit,
  children,
}: {
  type: 'date' | 'time';
  label: string;
  value: string;
  min?: string;
  accept: (v: string) => string | null;
  commit: (v: string) => void;
  /** What the pill says for a value. */
  children: (v: string) => ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const keyed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const settle = (final: boolean) => {
    clearTimeout(timer.current);
    const v = pending.current;
    if (final) keyed.current = false;
    if (v === null) return;
    const ok = accept(v);
    if (!final && keyed.current && ok !== v) return;
    pending.current = null;
    setDraft(null);
    if (ok !== null && ok !== value) commit(ok);
  };
  // Leaving the screen while it rests still saves it.
  const latest = useRef(settle);
  useEffect(() => {
    latest.current = settle;
  });
  useEffect(() => () => latest.current(true), []);

  return (
    <label className="pill when-field">
      {children(draft || value)}
      <input
        type={type}
        aria-label={label}
        value={draft ?? value}
        min={min}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter') settle(true);
          else keyed.current = true;
        }}
        onChange={(e) => {
          pending.current = e.target.value;
          setDraft(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => latest.current(false), QUIET_MS);
        }}
        onBlur={() => settle(true)}
      />
    </label>
  );
}

/**
 * With a mouse, the picker on a click anywhere on the pill (desktop browsers open it only from a
 * small icon, here invisible). A touch opens it by itself.
 */
function openPicker(e: MouseEvent<HTMLInputElement>) {
  if (!matchMedia('(pointer: fine)').matches) return;
  try {
    e.currentTarget.showPicker();
  } catch {
    // Not supported: the browser's own behaviour stays.
  }
}
