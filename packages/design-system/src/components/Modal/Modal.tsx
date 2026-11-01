import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode, RefObject } from 'react';
import dialogStyles from '../dialog.module.css';
import { CloseIcon } from '../icons.js';
import { useReturnFocus } from '../useReturnFocus.js';
import styles from './Modal.module.css';

export interface ModalProps {
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
}

export function Modal({ open, onOpenChange, title, description, children, closeLabel = 'Close', returnFocusRef }: ModalProps) {
  const returnFocus = useReturnFocus(returnFocusRef);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.overlay} />
        <Dialog.Content {...returnFocus} {...(description ? {} : { 'aria-describedby': undefined })} className={[dialogStyles.panel, styles.modal].join(' ')}>
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
