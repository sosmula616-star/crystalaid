import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import fieldStyles from '../field.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-invalid'> {
  label: string;
  error?: string;
  hint?: string;
  /** Hides the label visually; the accessible name stays. */
  hideLabel?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, hideLabel = false, id, className, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const described = [describedBy, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={fieldStyles.field}>
      <label htmlFor={inputId} className={hideLabel ? fieldStyles.srOnly : fieldStyles.label}>
        {label}
      </label>
      <input
        {...rest}
        ref={ref}
        id={inputId}
        className={[fieldStyles.control, className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
      />
      {hint ? (
        <span id={hintId} className={fieldStyles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className={fieldStyles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
});
