import { EmptyState, StatCard } from '@crystalaid/design-system';
import { useShell } from '../shell/context.js';
import styles from './Overview.module.css';

/** The signed-in person at a glance. Everything shown comes from `/me`. */
export default function Overview() {
  const { me, t, locale } = useShell();
  return (
    <div className={styles.overview}>
      <h2 className={styles.greeting}>{t('overview.greeting', { name: me.user.username })}</h2>
      <div className={styles.stats}>
        <StatCard label={t('overview.level')} value={t(`level.${me.level}`)} />
        {me.position ? <StatCard label={t('overview.position')} value={me.position} /> : null}
        <StatCard label={t('overview.balance')} value={new Intl.NumberFormat(locale).format(me.tokenBalance)} />
      </div>
      <EmptyState title={t('overview.later.title')} description={t('overview.later.description')} />
    </div>
  );
}
