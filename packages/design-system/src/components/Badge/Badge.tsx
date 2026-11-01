import type { HTMLAttributes } from 'react';
import styles from './Badge.module.css';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return <span {...rest} className={[styles.badge, styles[tone], className].filter(Boolean).join(' ')} />;
}
