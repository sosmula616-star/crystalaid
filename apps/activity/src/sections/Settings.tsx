import { useId, useState } from 'react';
import { Button, Select, THEMES, applyTheme, writeStored } from '@crystalaid/design-system';
import { isLocale, type Locale } from '@crystalaid/i18n';
import { useShell } from '../shell/context.js';
import { LOCALE_KEY, THEME_KEY } from '../storage-keys.js';
import styles from './Settings.module.css';

const LOCALES: readonly Locale[] = ['ru', 'en'];

/** Language and theme. Only the free theme can be chosen until the store opens. */
export default function Settings() {
  const { t, locale, setLocale } = useShell();
  const themeHeading = useId();
  const [current, setCurrent] = useState<string | undefined>(() => document.documentElement.dataset.theme);

  const changeLocale = (value: string) => {
    if (!isLocale(value)) return;
    writeStored(LOCALE_KEY, value);
    setLocale(value);
  };

  const chooseTheme = (id: string) => {
    const applied = applyTheme(id);
    writeStored(THEME_KEY, applied);
    setCurrent(applied);
  };

  return (
    <div className={styles.settings}>
      <Select
        label={t('settings.language')}
        value={locale}
        onChange={changeLocale}
        options={LOCALES.map((value) => ({ value, label: t(`settings.language.${value}`) }))}
      />
      <section aria-labelledby={themeHeading}>
        <h2 id={themeHeading} className={styles.heading}>
          {t('settings.theme')}
        </h2>
        <ul className={styles.themes}>
          {THEMES.map((theme) => {
            const reasonId = `${themeHeading}-${theme.id}`;
            const active = current === theme.id;
            return (
              <li key={theme.id} className={styles.theme}>
                <Button
                  variant={theme.free ? 'secondary' : 'ghost'}
                  aria-pressed={theme.free ? active : false}
                  disabled={!theme.free}
                  aria-describedby={theme.free ? undefined : reasonId}
                  onClick={theme.free ? () => chooseTheme(theme.id) : undefined}
                >
                  {t(theme.nameKey)}
                </Button>
                {theme.free ? null : (
                  <span id={reasonId} className={styles.reason}>
                    {t('settings.theme.locked')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
