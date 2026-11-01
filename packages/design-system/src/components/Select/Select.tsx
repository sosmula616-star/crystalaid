import * as RadixSelect from '@radix-ui/react-select';
import { useId } from 'react';
import fieldStyles from '../field.module.css';
import { CheckIcon, ChevronDownIcon } from '../icons.js';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Hides the label visually; the accessible name stays. */
  hideLabel?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function Select({ label, value, onChange, options, hideLabel = false, disabled, placeholder }: SelectProps) {
  const id = useId();
  if (options.some((option) => option.value === '')) {
    // Radix reserves the empty string for "no selection".
    throw new Error('Select: an option with value "" is not allowed; use a non-empty value.');
  }
  return (
    <div className={fieldStyles.field}>
      <label htmlFor={id} className={hideLabel ? fieldStyles.srOnly : fieldStyles.label}>
        {label}
      </label>
      <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
        <RadixSelect.Trigger id={id} className={fieldStyles.control}>
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className={styles.icon}>
            <ChevronDownIcon />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
            <RadixSelect.Viewport className={styles.viewport}>
              {options.map((option) => (
                <RadixSelect.Item key={option.value} value={option.value} className={styles.item}>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className={styles.indicator}>
                    <CheckIcon />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
