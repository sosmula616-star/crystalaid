import '@fontsource-variable/inter';
import '@crystalaid/design-system/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityAuthResponse } from '@crystalaid/contracts';
import { TooltipProvider, applyTheme, readStored } from '@crystalaid/design-system';
import { App } from './App.js';
import { createApiClient } from './api/client.js';
import { createDiscordPort } from './auth/discord.js';
import { createSession } from './auth/session.js';
import { readClientId } from './runtime-config.js';
import { THEME_KEY } from './storage-keys.js';


async function start() {
  applyTheme(readStored(THEME_KEY) ?? 'crystal');
  const root = createRoot(document.getElementById('root')!);

  // Dev only: the showcase. The DEV check lets the bundler drop the import from production.
  if (import.meta.env.DEV && location.pathname === '/kit') {
    const { Kit } = await import('./dev/Kit.js');
    root.render(
      <StrictMode>
        <TooltipProvider>
          <Kit />
        </TooltipProvider>
      </StrictMode>,
    );
    return;
  }

  // Dev only: a fake Discord SDK and API (see `pnpm dev:mock`).
  const mock =
    import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK === '1'
      ? (await import('./dev/mock.js')).createMock(new URLSearchParams(location.search))
      : null;

  const sdk = mock?.sdk ?? createDiscordPort(readClientId());

  // The client and the session need each other: the client asks the session to
  // refresh, the session logs in through the client.
  const api = createApiClient({
    getToken: () => session.token(),
    refresh: () => session.refresh(),
    ...(mock ? { fetch: mock.fetch } : {}),
  });
  // A stable function: the shell subscribes in an effect that depends on it.
  const onLayoutMode = (callback: (mode: number) => void) => sdk.onLayoutMode(callback);
  const session = createSession({
    sdk,
    login: (code, instanceId) => api.post('/auth/activity', { code, instanceId }, ActivityAuthResponse),
  });

  root.render(
    <StrictMode>
      <TooltipProvider>
        <App session={session} api={api} discordLocale={() => sdk.locale} onLayoutMode={onLayoutMode} />
      </TooltipProvider>
    </StrictMode>,
  );
}

void start();
