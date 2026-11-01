import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode, RefObject } from 'react';
import dialogStyles from '../dialog.module.css';
import { CloseIcon } from '../icons.js';
import { useReturnFocus } from '../useReturnFocus.js';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional; without it the dialog has no aria-describedby. */
  description?: string;
  children?: ReactNode;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Element that gets focus back on close, e.g. the trigger of the menu that opened it. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Runs when the drawer has closed. Call `event.preventDefault()` to move focus yourself instead of returning it. */
  onCloseAutoFocus?: (event: Event) => void;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  closeLabel = 'Close',
  returnFocusRef,
  onCloseAutoFocus,
}: DrawerProps) {
  const returnFocus = useReturnFocus(returnFocusRef);
  const handleCloseAutoFocus = (event: Event) => {
    onCloseAutoFocus?.(event);
    if (!event.defaultPrevented) returnFocus.onCloseAutoFocus(event);
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.overlay} />
        <Dialog.Content onOpenAutoFocus={returnFocus.onOpenAutoFocus} onCloseAutoFocus={handleCloseAutoFocus}{...(description ? {} : { 'aria-describedby': undefined })} className={[dialogStyles.panel, styles.drawer].join(' ')}>
          <div className={dialogStyles.header}>
            <div className={dialogStyles.heading}>
              <Dialog.Title className={dialogStyles.title}>{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className={dialogStyles.description}>{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className={dialogStyles.close} aria-label={closeLabel}>
              <CloseIcon />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
