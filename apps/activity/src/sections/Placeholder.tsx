import { EmptyState } from '@crystalaid/design-system';
import { useShell } from '../shell/context.js';

/** Stands in for every section that has no screen yet. */
export default function Placeholder() {
  const { t } = useShell();
  return <EmptyState title={t('shell.placeholder.title')} />;
}
