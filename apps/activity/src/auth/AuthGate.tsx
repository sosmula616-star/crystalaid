import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MeResponse } from '@crystalaid/contracts';
import { Button, ToastProvider } from '@crystalaid/design-system';
import { createTranslator, resolveLocale, type Locale, type MessageKey } from '@crystalaid/i18n';
import { ApiError, type ApiClient } from '../api/client.js';
import logoUrl from '../assets/logo.png';
import type { Session } from './session.js';
import styles from './AuthGate.module.css';

type Translate = ReturnType<typeof createTranslator>;

export interface AuthGateContext {
  t: Translate;
  locale: Locale;
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
  /** Show the message sent by the server instead of the description. */
  serverMessage?: boolean;
  retry: boolean;
}

function describeFailure(error: unknown): Failure {
  const code = error instanceof ApiError ? error.code : 'NETWORK';
  switch (code) {
    case 'NOT_STAFF':
      return { title: 'auth.notStaff.title', description: 'auth.notStaff.description', serverMessage: true, retry: false };
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

export function AuthGate({ session, api, discordLocale, children }: AuthGateProps) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(navigator.language));
  const run = useRef(0);
  const started = useRef(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  // Without a known Discord locale the current one stays.
  const adoptDiscordLocale = useCallback(() => {
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
        {children(state.me, { t, locale, retryAuth, reportAuthFailure })}
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
  const serverMessage =
    failure.serverMessage && state.error instanceof ApiError && state.error.message ? state.error.message : null;
  return (
    <main className={styles.screen}>
      <img className={styles.logo} src={logoUrl} alt={t('auth.logoAlt')} />
      <div className={styles.failure} role="alert">
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {t(failure.title)}
        </h1>
        <p className={styles.description}>{serverMessage ?? t(failure.description)}</p>
        {failure.retry ? (
          <Button variant="secondary" onClick={retryAuth}>
            {t('auth.retry')}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
