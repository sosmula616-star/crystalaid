import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import dialogStyles from '../dialog.module.css';
import { CloseIcon } from '../icons.js';
import { useReturnFocus } from '../useReturnFocus.js';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
  /** Accessible name of the close button. */
  closeLabel?: string;
}

export function Drawer({ open, onOpenChange, title, description, children, closeLabel = 'Close' }: DrawerProps) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.overlay} />
        <Dialog.Content {...returnFocus} className={[dialogStyles.panel, styles.drawer].join(' ')}>
          <div className={dialogStyles.header}>
            <div className={dialogStyles.heading}>
              <Dialog.Title className={dialogStyles.title}>{title}</Dialog.Title>
              <Dialog.Description className={dialogStyles.description}>{description}</Dialog.Description>
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
