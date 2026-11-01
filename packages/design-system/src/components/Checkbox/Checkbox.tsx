import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { useId } from 'react';
import { CheckIcon } from '../icons.js';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({ label, checked, onChange, disabled }: CheckboxProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <RadixCheckbox.Root
        id={id}
        className={styles.box}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      >
        <RadixCheckbox.Indicator className={styles.indicator}>
          <CheckIcon />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id} className={styles.label} data-disabled={disabled || undefined}>
        {label}
      </label>
    </div>
  );
}
