import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Skeleton } from '@crystalaid/design-system';
import type { MeResponse } from '@crystalaid/contracts';
import { BottomNav } from './BottomNav.js';
import { ShellContext, type Translate } from './context.js';
import { isAuthError, SectionBoundary } from './SectionBoundary.js';
import { SECTIONS, visibleSections, type Section, type SectionId } from './sections.js';
import { SideNav } from './SideNav.js';
import { TopBar } from './TopBar.js';
import { useLayoutMode } from './useLayoutMode.js';
import styles from './Shell.module.css';

export interface ShellProps {
  me: MeResponse;
  t: Translate;
  /** Runs the sign-in again; the retry action of an auth error that stays on screen. */
  onRetryAuth: () => void;
  /** An auth error reached a section: the gate replaces the panel with its failure screen. */
  reportAuthFailure: (error: unknown) => void;
  /** Subscribes to Discord's layout mode; returns the unsubscribe function. */
  onLayoutMode?: ((callback: (mode: number) => void) => () => void) | undefined;
  /** For tests. */
  sections?: readonly Section[];
}

const FIRST_SECTION: SectionId = 'overview';

function SectionSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      <Skeleton height={32} width="40%" />
      <Skeleton height={120} />
      <Skeleton height={120} />
    </div>
  );
}

interface SectionViewProps {
  section: Section;
  t: Translate;
  onRetryAuth: () => void;
  reportAuthFailure: (error: unknown) => void;
}

/** One section: lazy, with its own error boundary. A retry loads the section again. */
function SectionView({ section, t, onRetryAuth, reportAuthFailure }: SectionViewProps) {
  const [attempt, setAttempt] = useState(0);
  // React.lazy remembers a failed load, so every attempt gets a fresh component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const Component = useMemo(() => lazy(section.load), [section, attempt]);
  return (
    <SectionBoundary
      key={attempt}
      t={t}
      onError={(error) => {
        if (isAuthError(error)) reportAuthFailure(error);
      }}
      onRetry={(error) => (isAuthError(error) ? onRetryAuth() : setAttempt((n) => n + 1))}
    >
      <Suspense fallback={<SectionSkeleton label={t('shell.loadingSection')} />}>
        <Component />
      </Suspense>
    </SectionBoundary>
  );
}

export function Shell({ me, t, onRetryAuth, reportAuthFailure, onLayoutMode, sections = SECTIONS }: ShellProps) {
  const [activeId, setActiveId] = useState<SectionId>(FIRST_SECTION);
  const [discordMode, setDiscordMode] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mode = useLayoutMode(discordMode, rootRef);

  useEffect(() => {
    if (!onLayoutMode) return;
    try {
      return onLayoutMode(setDiscordMode);
    } catch (error) {
      // Outside Discord there is no layout mode; the width decides.
      console.warn('Discord layout mode is not available', error);
    }
  }, [onLayoutMode]);

  const available = useMemo(() => visibleSections(me.level, me.permissions, sections), [me, sections]);
  const active = available.find((s) => s.id === activeId) ?? available[0];

  // Keyboard and screen reader users land on the new section, not on the button they pressed.
  const shown = useRef(active?.id);
  useEffect(() => {
    if (shown.current === active?.id) return;
    shown.current = active?.id;
    headingRef.current?.focus();
  }, [active?.id]);

  const context = useMemo(() => ({ me, t }), [me, t]);
  const compact = mode === 'compact';
  const nav = { sections: available, activeId: active?.id ?? FIRST_SECTION, onSelect: setActiveId, t };
  const title = active ? t(active.labelKey) : '';

  return (
    <ShellContext.Provider value={context}>
      <div ref={rootRef} className={styles.shell} data-mode={mode}>
        <a className={styles.skip} href="#main-content">
          {t('shell.skipToContent')}
        </a>
        {compact ? null : <TopBar title={title} me={me} t={t} headingRef={headingRef} />}
        <div className={styles.body}>
          {mode === 'medium' || mode === 'wide' || mode === 'ultrawide' ? (
            <SideNav {...nav} iconOnly={mode === 'medium'} />
          ) : null}
          <main id="main-content" className={styles.main}>
            {compact ? (
              <div className={styles.compact}>
                <h1 ref={headingRef} tabIndex={-1} className={styles.compactTitle}>
                  {title}
                </h1>
                <Button onClick={() => setActiveId(FIRST_SECTION)}>{t('shell.openOverview')}</Button>
              </div>
            ) : active ? (
              <div className={styles.content}>
                <SectionView
                  key={active.id}
                  section={active}
                  t={t}
                  onRetryAuth={onRetryAuth}
                  reportAuthFailure={reportAuthFailure}
                />
              </div>
            ) : null}
          </main>
        </div>
        {mode === 'narrow' ? <BottomNav {...nav} /> : null}
      </div>
    </ShellContext.Provider>
  );
}
