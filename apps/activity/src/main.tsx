import '@fontsource-variable/inter';
import '@crystalaid/design-system/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityAuthResponse } from '@crystalaid/contracts';
import { ToastProvider, TooltipProvider, applyTheme, readStored } from '@crystalaid/design-system';
import { App } from './App.js';
import { createApiClient } from './api/client.js';
import { createDiscordPort } from './auth/discord.js';
import { createSession } from './auth/session.js';

const THEME_KEY = 'crystalaid.theme';
applyTheme(readStored(THEME_KEY) ?? 'crystal');

const sdk = createDiscordPort(import.meta.env.VITE_DISCORD_CLIENT_ID);

// The client and the session need each other: the client asks the session to
// refresh, the session logs in through the client.
const api = createApiClient({
  getToken: () => session.token(),
  refresh: () => session.refresh(),
});
const session = createSession({
  sdk,
  login: (code, instanceId) => api.post('/auth/activity', { code, instanceId }, ActivityAuthResponse),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <App session={session} api={api} discordLocale={() => sdk.locale} />
      </TooltipProvider>
    </ToastProvider>
  </StrictMode>,
);
