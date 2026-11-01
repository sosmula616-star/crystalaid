import { AuthGate } from './auth/AuthGate.js';
import type { ApiClient } from './api/client.js';
import type { DiscordPort, Session } from './auth/session.js';
import { Shell } from './shell/Shell.js';

export interface AppProps {
  session: Session;
  api: ApiClient;
  discordLocale?: () => string | undefined;
  onLayoutMode?: DiscordPort['onLayoutMode'];
}

export function App({ session, api, discordLocale, onLayoutMode }: AppProps) {
  return (
    <AuthGate session={session} api={api} {...(discordLocale ? { discordLocale } : {})}>
      {(me, { t, locale, setLocale, retryAuth, reportAuthFailure }) => (
        <Shell
          me={me}
          t={t}
          locale={locale}
          onLocaleChange={setLocale}
          onRetryAuth={retryAuth}
          reportAuthFailure={reportAuthFailure}
          onLayoutMode={onLayoutMode}
        />
      )}
    </AuthGate>
  );
}
