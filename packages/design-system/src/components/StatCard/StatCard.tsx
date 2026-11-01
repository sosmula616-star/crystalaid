import type { HTMLAttributes, ReactNode } from 'react';
import { Card } from '../Card/Card.js';
import styles from './StatCard.module.css';

export interface StatCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

export function StatCard({ label, value, hint, className, ...rest }: StatCardProps) {
  return (
    <Card {...rest} className={[styles.stat, className].filter(Boolean).join(' ')}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </Card>
  );
}
