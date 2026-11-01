import { useRef, type RefObject } from 'react';

function isFocusTarget(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.isConnected && el !== document.body && el.tabIndex >= 0 && !el.matches(':disabled');
}

/**
 * Radix returns focus only to its own Dialog.Trigger. Our dialogs are
 * controlled by `open`, so focus goes to `returnFocusRef` when the caller names
 * one (needed when the opener is gone, like a menu item). Otherwise to the
 * element that had focus when the dialog took over, if that is still a
 * focusable element other than body; else Radix's default runs.
 */
export function useReturnFocus(returnFocusRef?: RefObject<HTMLElement | null>) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const named = returnFocusRef?.current;
      const target = isFocusTarget(named) ? named : isFocusTarget(opener.current) ? opener.current : null;
      opener.current = null;
      if (target) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}
