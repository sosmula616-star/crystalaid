import type { HTMLAttributes } from 'react';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  value: number;
  max?: number;
  /** Accessible name. */
  label: string;
}

export function ProgressBar({ value, max = 100, label, className, ...rest }: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  return (
    <div
      {...rest}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      className={[styles.track, className].filter(Boolean).join(' ')}
    >
      <div className={styles.fill} style={{ width: `${(safeValue / safeMax) * 100}%` }} />
    </div>
  );
}
