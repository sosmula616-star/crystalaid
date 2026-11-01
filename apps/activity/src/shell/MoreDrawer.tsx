import { useRef, type RefObject } from 'react';
import { Drawer } from '@crystalaid/design-system';
import { NavGroups, type NavListProps } from './SideNav.js';
import styles from './Nav.module.css';

export interface MoreDrawerProps extends NavListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** After a section was chosen, focus goes here (the section heading) instead of back to the opener. */
  focusHeading: () => void;
}

/** The sections that do not fit in the bottom bar. Choosing one closes the drawer. */
export function MoreDrawer({ open, onOpenChange, returnFocusRef, focusHeading, onSelect, t, ...rest }: MoreDrawerProps) {
  const chosen = useRef(false);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('shell.moreTitle')}
      closeLabel={t('shell.closeMore')}
      returnFocusRef={returnFocusRef}
      onCloseAutoFocus={(event) => {
        // Escape and the close button leave `chosen` false: focus returns to "More".
        if (!chosen.current) return;
        chosen.current = false;
        event.preventDefault();
        focusHeading();
      }}
    >
      <div className={styles.drawerList}>
        <NavGroups
          {...rest}
          t={t}
          onSelect={(id) => {
            chosen.current = true;
            onSelect(id);
            onOpenChange(false);
          }}
        />
      </div>
    </Drawer>
  );
}
