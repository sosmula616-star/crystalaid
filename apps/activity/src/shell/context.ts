import { createContext, useContext } from 'react';
import type { MeResponse } from '@crystalaid/contracts';
import type { createTranslator } from '@crystalaid/i18n';

export type Translate = ReturnType<typeof createTranslator>;

export interface ShellContextValue {
  me: MeResponse;
  t: Translate;
}

/** What every section needs: the signed-in user and the translator. */
export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside <Shell>');
  return value;
}
