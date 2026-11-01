import type { Ref } from 'react';
import { Badge } from '@crystalaid/design-system';
import type { MeResponse } from '@crystalaid/contracts';
import logoUrl from '../assets/logo-160.png';
import type { Translate } from './context.js';
import styles from './TopBar.module.css';

export interface TopBarProps {
  title: string;
  me: MeResponse;
  t: Translate;
  /** Receives focus when the section changes. */
  headingRef: Ref<HTMLHeadingElement>;
}

export function TopBar({ title, me, t, headingRef }: TopBarProps) {
  const name = me.user.username;
  return (
    <header className={styles.bar}>
      <img className={styles.logo} src={logoUrl} alt={t('auth.logoAlt')} />
      <h1 ref={headingRef} tabIndex={-1} className={styles.title} title={title}>
        {title}
      </h1>
      <div className={styles.user}>
        {/* No tab stop: the full name is always in the DOM and in `title` for pointer users. */}
        <span className={styles.name} title={name}>
          {name}
        </span>
        <Badge tone="primary">{t(`level.${me.level}`)}</Badge>
      </div>
    </header>
  );
}
