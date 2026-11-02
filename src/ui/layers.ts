// What is open on top of a screen (a sheet, a menu, a panel), newest last.
// Escape and Android's Back close the top one before they leave the screen.
import { useEffect } from 'react';

const stack: (() => void)[] = [];

/** Closes the top layer; false when there is none. */
export function closeTopLayer(): boolean {
  const close = stack.at(-1);
  if (!close) return false;
  close();
  return true;
}

/** While `open`, `close` is on the stack (Escape and Back call it first). */
export function useLayer(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    stack.push(close);
    return () => {
      const i = stack.lastIndexOf(close);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, close]);
}

if (typeof window !== 'undefined')
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (closeTopLayer()) e.preventDefault();
  });
