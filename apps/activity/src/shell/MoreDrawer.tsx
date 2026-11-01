import type { RefObject } from 'react';
import { Drawer } from '@crystalaid/design-system';
import { NavGroups, type NavListProps } from './SideNav.js';
import styles from './Nav.module.css';

export interface MoreDrawerProps extends NavListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

/** The sections that do not fit in the bottom bar. Choosing one closes the drawer. */
export function MoreDrawer({ open, onOpenChange, returnFocusRef, onSelect, t, ...rest }: MoreDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('shell.moreTitle')}
      closeLabel={t('shell.closeMore')}
      returnFocusRef={returnFocusRef}
    >
      <div className={styles.drawerList}>
        <NavGroups
          {...rest}
          t={t}
          onSelect={(id) => {
            onSelect(id);
            onOpenChange(false);
          }}
        />
      </div>
    </Drawer>
  );
}
