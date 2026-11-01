import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ReactElement } from 'react';
import styles from './Dropdown.module.css';

export interface DropdownItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface DropdownProps {
  /** A single focusable element, usually a button. */
  trigger: ReactElement;
  items: DropdownItem[];
}

export function Dropdown({ trigger, items }: DropdownProps) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={styles.content} align="end" sideOffset={4}>
          {items.map((item) => (
            <Menu.Item key={item.id} className={styles.item} disabled={item.disabled} onSelect={item.onSelect}>
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
