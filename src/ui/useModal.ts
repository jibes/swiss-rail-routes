// A modal sheet's focus (AddSheet, ShareSheet): it goes in when the sheet opens,
// stays inside while Tab moves, and goes back to where it was when the sheet closes (review of
// 11 Nov 2026: Prices and the whole run left it behind the scrim).
import { useEffect, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input, summary, [href], [tabindex]:not([tabindex="-1"])';

/** What Tab can reach in the sheet now: not inside a fold closed or anything hidden. */
const reachable = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
    typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.offsetParent !== null,
  );

export function useModal(
  sheet: RefObject<HTMLElement | null>,
  first?: RefObject<HTMLElement | null>,
): (e: KeyboardEvent) => void {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (first?.current ?? (sheet.current && reachable(sheet.current)[0]))?.focus();
    return () => {
      // After the key that closed it is done: Enter on a result must not also press the
      // button focus goes back to (it would open the sheet again).
      setTimeout(() => {
        if (before?.isConnected) before.focus();
      }, 0);
    };
    // Once, as the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (e) => {
    if (e.key !== 'Tab' || !sheet.current) return;
    const all = reachable(sheet.current);
    const head = all[0];
    const last = all.at(-1);
    if (e.shiftKey && document.activeElement === head) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      head?.focus();
    }
  };
}
