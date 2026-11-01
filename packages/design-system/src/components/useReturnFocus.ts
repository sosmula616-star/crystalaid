import { useRef } from 'react';

/**
 * Radix returns focus only to its own Dialog.Trigger. Our dialogs are
 * controlled by `open`, so the opener is whatever had focus when the dialog
 * took over; remember it and give focus back on close.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      if (opener.current?.isConnected) {
        event.preventDefault();
        opener.current.focus();
      }
      opener.current = null;
    },
  };
}
