import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../Button/Button.js';
import styles from './ErrorState.module.css';

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role'> {
  title: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  /** Text of the retry button; shown only together with onRetry. */
  retryLabel: string;
}

export function ErrorState({ title, description, onRetry, retryLabel, className, ...rest }: ErrorStateProps) {
  return (
    <div {...rest} role="alert" className={[styles.error, className].filter(Boolean).join(' ')}>
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {onRetry ? (
        <div className={styles.action}>
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
