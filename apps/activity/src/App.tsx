import { Card } from '@crystalaid/design-system';
import { AuthGate } from './auth/AuthGate.js';
import type { ApiClient } from './api/client.js';
import type { Session } from './auth/session.js';

export interface AppProps {
  session: Session;
  api: ApiClient;
  discordLocale?: () => string | undefined;
}

/** Placeholder shell: the navigation and sections arrive in the next task. */
export function App({ session, api, discordLocale }: AppProps) {
  return (
    <AuthGate session={session} api={api} {...(discordLocale ? { discordLocale } : {})}>
      {(me) => (
        <main style={{ padding: 'var(--space-6)' }}>
          <Card>{me.user.username}</Card>
        </main>
      )}
    </AuthGate>
  );
}
