import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MeResponse } from '@crystalaid/contracts';
import { Button, readStored, ToastProvider } from '@crystalaid/design-system';
import { createTranslator, isLocale, resolveLocale, type Locale, type MessageKey } from '@crystalaid/i18n';
import { ApiError, type ApiClient } from '../api/client.js';
import logoUrl from '../assets/logo-160.png';
import { LOCALE_KEY } from '../storage-keys.js';
import type { Session } from './session.js';
import styles from './AuthGate.module.css';

type Translate = ReturnType<typeof createTranslator>;

export interface AuthGateContext {
  t: Translate;
  locale: Locale;
  /** Switches the language. The caller saves the choice; the stored one wins at the next start. */
  setLocale(locale: Locale): void;
  /** Runs the sign-in again, as the Retry button does. */
  retryAuth(): void;
  /**
   * Call when a request failed even after the silent re-login (the sign-in itself
   * failed). The gate then replaces the app with its failure screen and Retry.
   */
  reportAuthFailure(error: unknown): void;
}

export interface AuthGateProps {
  session: Session;
  api: ApiClient;
  /** Discord locale such as `ru` or `en-US`; read once the sign-in has run. */
  discordLocale?: () => string | undefined;
  children: (me: MeResponse, context: AuthGateContext) => ReactNode;
}

type State = { phase: 'loading' } | { phase: 'ready'; me: MeResponse } | { phase: 'failed'; error: unknown };

interface Failure {
  title: MessageKey;
  description: MessageKey;
  retry: boolean;
}

/** Machine-readable server reasons for NOT_STAFF and the text that explains each one. */
const NOT_STAFF_REASONS: Record<string, MessageKey> = {
  support_role_missing: 'auth.notStaff.supportRoleMissing',
  not_in_branch: 'auth.notStaff.notInBranch',
};

function describeFailure(error: unknown): Failure {
  const code = error instanceof ApiError ? error.code : 'NETWORK';
  switch (code) {
    case 'NOT_STAFF':
      return {
        title: 'auth.notStaff.title',
        description: (error instanceof ApiError && error.reason && Object.hasOwn(NOT_STAFF_REASONS, error.reason) && NOT_STAFF_REASONS[error.reason]) || 'auth.notStaff.description',
        retry: false,
      };
    case 'GUILD_REQUIRED':
      return { title: 'auth.guildRequired.title', description: 'auth.guildRequired.description', retry: false };
    case 'INVALID_INSTANCE':
      return { title: 'auth.invalidInstance.title', description: 'auth.invalidInstance.description', retry: false };
    case 'DISCORD_UNAVAILABLE':
    case 'NETWORK':
      return { title: 'auth.unavailable.title', description: 'auth.unavailable.description', retry: true };
    default:
      return { title: 'auth.error.title', description: 'auth.error.description', retry: true };
  }
}

function storedLocale(): Locale | null {
  const value = readStored(LOCALE_KEY);
  return value !== null && isLocale(value) ? value : null;
}

export function AuthGate({ session, api, discordLocale, children }: AuthGateProps) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [locale, setLocale] = useState<Locale>(() => storedLocale() ?? resolveLocale(navigator.language));
  const run = useRef(0);
  const started = useRef(false);
  // A language chosen in this session wins over Discord's even when saving it failed.
  const chosen = useRef<Locale | null>(null);
  const chooseLocale = useCallback((next: Locale) => {
    chosen.current = next;
    setLocale(next);
  }, []);

  const headingRef = useRef<HTMLHeadingElement>(null);

  // The language the person chose in Settings wins over Discord's. Without a
  // known Discord locale the current one stays.
  const adoptDiscordLocale = useCallback(() => {
    if (chosen.current || storedLocale()) return;
    const discord = discordLocale?.();
    if (discord) setLocale(resolveLocale(discord));
  }, [discordLocale]);

  const signIn = useCallback(async () => {
    const id = ++run.current;
    setState({ phase: 'loading' });
    try {
      await session.start();
      if (id === run.current) adoptDiscordLocale();
      const me = await api.get('/me', MeResponse);
      if (id !== run.current) return;
      setState({ phase: 'ready', me });
    } catch (error) {
      if (id !== run.current) return;
      adoptDiscordLocale();
      setState({ phase: 'failed', error });
    }
  }, [session, api, adoptDiscordLocale]);

  const retryAuth = useCallback(() => void signIn(), [signIn]);

  const reportAuthFailure = useCallback((error: unknown) => {
    run.current += 1;
    setState({ phase: 'failed', error });
  }, []);

  const failed = state.phase === 'failed';
  useEffect(() => {
    // Keyboard users keep their place: the pressed Retry button is gone after a retry.
    if (failed) headingRef.current?.focus();
  }, [failed]);

  useEffect(() => {
    // StrictMode mounts effects twice; a sign-in must start once.
    if (started.current) return;
    started.current = true;
    void signIn();
  }, [signIn]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = createTranslator(locale);

  if (state.phase === 'ready') {
    return (
      <ToastProvider closeLabel={t('toast.close')} regionLabel={t('toast.region')}>
        {children(state.me, { t, locale, setLocale: chooseLocale, retryAuth, reportAuthFailure })}
      </ToastProvider>
    );
  }

  if (state.phase === 'loading') {
    return (
      <main className={styles.screen}>
        <img className={styles.logo} src={logoUrl} alt={t('auth.logoAlt')} />
        <div className={styles.status} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>{t('auth.signingIn')}</span>
        </div>
      </main>
    );
  }

  const failure = describeFailure(state.error);
  return (
    <main className={styles.screen}>
      <img className={styles.logo} src={logoUrl} alt={t('auth.logoAlt')} />
      <div className={styles.failure} role="alert">
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {t(failure.title)}
        </h1>
        <p className={styles.description}>{t(failure.description)}</p>
        {failure.retry ? (
          <Button variant="secondary" onClick={retryAuth}>
            {t('auth.retry')}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
