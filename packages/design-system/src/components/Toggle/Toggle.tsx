import * as RadixSwitch from '@radix-ui/react-switch';
import { useId } from 'react';
import styles from './Toggle.module.css';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.label} data-disabled={disabled || undefined}>
        {label}
      </label>
      <RadixSwitch.Root id={id} className={styles.track} checked={checked} disabled={disabled} onCheckedChange={onChange}>
        <RadixSwitch.Thumb className={styles.thumb} />
      </RadixSwitch.Root>
    </div>
  );
}
