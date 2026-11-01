import type { Ref } from 'react';
import { Badge, Tooltip } from '@crystalaid/design-system';
import type { MeResponse } from '@crystalaid/contracts';
import logoUrl from '../assets/logo.png';
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
      <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
        {title}
      </h1>
      <div className={styles.user}>
        {/* The tooltip only repeats a truncated name; the name itself is always in the DOM. */}
        <Tooltip content={name}>
          <span className={styles.name} tabIndex={0}>
            {name}
          </span>
        </Tooltip>
        <Badge tone="primary">{t(`level.${me.level}`)}</Badge>
      </div>
    </header>
  );
}
