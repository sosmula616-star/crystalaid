import { Component, type ReactNode } from 'react';
import { ErrorState } from '@crystalaid/design-system';
import { ApiError } from '../api/client.js';
import type { Translate } from './context.js';

/** A request failed even after the silent re-login. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'UNAUTHORIZED' || error.code === 'TOKEN_EXPIRED');
}

export interface SectionBoundaryProps {
  t: Translate;
  /** Called once per failure, for logging or for reporting an auth error. */
  onError?: (error: unknown) => void;
  /** Called by the retry button. The parent decides what retrying means. */
  onRetry: (error: unknown) => void;
  children: ReactNode;
}

interface State {
  error: { value: unknown } | null;
}

/**
 * Catches render errors and failed lazy loads of one section, so the rest of
 * the panel keeps working. A new `key` resets it.
 */
export class SectionBoundary extends Component<SectionBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: { value: error } };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { t, onRetry } = this.props;
    return (
      <ErrorState
        title={t('shell.sectionError.title')}
        description={t('shell.sectionError.description')}
        retryLabel={t('auth.retry')}
        onRetry={() => onRetry(error.value)}
      />
    );
  }
}
