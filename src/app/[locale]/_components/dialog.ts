'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * What makes an overlay a dialog rather than a div that looks like one.
 *
 * ⚠ THIS REPLACED FOUR NEAR-IDENTICAL COPIES of the same escape handler and
 * focus trap, in the item sheet, the cart drawer, the address sheet and the
 * sign-in sheet. They had drifted: two trapped Tab and two did not, and none
 * of the four put focus back where it came from.
 *
 * ⭐ THE RETURN IS THE PART THAT WAS MISSING EVERYWHERE, and it is the half a
 * keyboard user actually feels. Opening a sheet from the fourth card in the
 * grid and closing it dropped focus back to `<body>`, so the next Tab started
 * again at the skip link and the customer had to walk the whole header to get
 * back to where they were. The design system asks for it in so many words:
 * "closing restores focus to the invoking control".
 *
 * ⚠ THE INVOKER IS CAPTURED ON MOUNT, not passed in. Every one of these
 * overlays is opened from a global store rather than by a component that holds
 * a ref to the button, so the only thing that reliably knows what was clicked
 * is `document.activeElement` at the moment the panel appears.
 *
 * ⚠ THE RESTORE IS GUARDED ON `isConnected`. Closing the item sheet after
 * adding to the basket can unmount the card that opened it, and calling
 * `.focus()` on a detached node silently does nothing while looking like it
 * worked. When the invoker is gone, focus is left alone rather than sent
 * somewhere arbitrary.
 */
export function useDialog(
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
  /** Focused on open. Omit to focus the panel's first focusable child. */
  initial?: RefObject<HTMLElement | null>,
): void {
  // A ref, not state: nothing renders from it and writing it must not re-run
  // the effect that captured it.
  const invoker = useRef<Element | null>(null);

  useEffect(() => {
    invoker.current = document.activeElement;

    return () => {
      const previous = invoker.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const target = initial?.current ?? firstFocusable(panel.current);
    target?.focus();
    // Only on mount. A sheet whose contents change (the sign-in sheet moves
    // from a phone field to a code field) manages that step itself; stealing
    // focus back on every render would fight the customer's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || panel.current === null) return;

      const focusable = focusableIn(panel.current);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, onClose]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // `offsetParent` is null for anything `display: none`, which is how the
    // sign-in sheet's second step hides the first one. A trap that stops on an
    // invisible element traps nothing and confuses everything.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function firstFocusable(root: HTMLElement | null): HTMLElement | undefined {
  return root === null ? undefined : focusableIn(root)[0];
}

/**
 * Locks the page behind an overlay, and restores exactly what was there.
 *
 * Split from `useDialog` because the item sheet deliberately does NOT use it:
 * it is short, it is opened from a grid, and freezing a page that is already
 * fully visible behind a 32rem panel buys nothing and costs a scrollbar-width
 * layout shift on a laptop.
 */
export function useScrollLock(): void {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}
