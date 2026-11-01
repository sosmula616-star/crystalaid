import { createContext, useContext } from 'react';
import type { MeResponse } from '@crystalaid/contracts';
import type { createTranslator, Locale } from '@crystalaid/i18n';

export type Translate = ReturnType<typeof createTranslator>;

export interface CompactAction {
  label: string;
  onSelect: () => void;
}

export interface ShellContextValue {
  me: MeResponse;
  t: Translate;
  locale: Locale;
  /** Switches the language of the whole app. Persisting the choice is the caller's job. */
  setLocale: (locale: Locale) => void;
  /**
   * The one button the compact (picture-in-picture) view shows next to the title.
   * A section sets it while mounted and clears it with `null`. Default: none.
   */
  setCompactAction: (action: CompactAction | null) => void;
}

/** What every section needs: the signed-in user and the translator. */
export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside <Shell>');
  return value;
}
