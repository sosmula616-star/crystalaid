import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { Button, Skeleton } from '@crystalaid/design-system';
import type { MeResponse } from '@crystalaid/contracts';
import type { Locale } from '@crystalaid/i18n';
import { BottomNav } from './BottomNav.js';
import { ShellContext, type CompactAction, type Translate } from './context.js';
import { isAuthError, SectionBoundary } from './SectionBoundary.js';
import { SECTIONS, visibleSections, type Section, type SectionId } from './sections.js';
import { SideNav } from './SideNav.js';
import { TopBar } from './TopBar.js';
import { useLayoutMode } from './useLayoutMode.js';
import styles from './Shell.module.css';

export interface ShellProps {
  me: MeResponse;
  t: Translate;
  /** The active language and the way to change it. Default: Russian, no change. */
  locale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
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

/**
 * One lazy component per loader, so returning to a loaded section shows no skeleton.
 * An entry is dropped when its load or render fails, so a retry loads again.
 */
const lazyCache = new WeakMap<Section['load'], LazyExoticComponent<ComponentType>>();

function lazyFor(section: Section): LazyExoticComponent<ComponentType> {
  let component = lazyCache.get(section.load);
  if (!component) {
    component = lazy(() =>
      section.load().catch((error: unknown) => {
        lazyCache.delete(section.load);
        throw error;
      }),
    );
    lazyCache.set(section.load, component);
  }
  return component;
}

/** One section: lazy, with its own error boundary. A retry loads the section again. */
function SectionView({ section, t, onRetryAuth, reportAuthFailure }: SectionViewProps) {
  const [attempt, setAttempt] = useState(0);
  // `attempt` forces a fresh lookup after a retry: a failed entry was dropped from the cache.
  const Component = useMemo(() => lazyFor(section), [section, attempt]);
  return (
    <SectionBoundary
      key={attempt}
      t={t}
      onError={(error) => {
        // A failed section is loaded again on retry, whatever the failure was.
        lazyCache.delete(section.load);
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

const noLocaleChange = () => {};

export function Shell({ me, t, locale = 'ru', onLocaleChange = noLocaleChange, onRetryAuth, reportAuthFailure, onLayoutMode, sections = SECTIONS }: ShellProps) {
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

  const [compactAction, setCompactAction] = useState<CompactAction | null>(null);
  const context = useMemo(
    () => ({ me, t, locale, setLocale: onLocaleChange, setCompactAction }),
    [me, t, locale, onLocaleChange],
  );
  // A compact action belongs to the section that set it; the new section sets its own.
  // Choosing the section that is already open changes nothing, so its action stays.
  const activeSectionId = active?.id;
  const selectSection = useCallback(
    (id: SectionId) => {
      if (id === activeSectionId) return;
      setCompactAction(null);
      setActiveId(id);
    },
    [activeSectionId],
  );
  const focusHeading = useCallback(() => headingRef.current?.focus(), []);
  const compact = mode === 'compact';
  const nav = { sections: available, activeId: active?.id ?? FIRST_SECTION, onSelect: selectSection, t };
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
          <main id="main-content" tabIndex={-1} className={styles.main}>
            {compact ? (
              <div className={styles.compact}>
                <h1 ref={headingRef} tabIndex={-1} className={styles.compactTitle}>
                  {title}
                </h1>
                {compactAction ? <Button onClick={compactAction.onSelect}>{compactAction.label}</Button> : null}
              </div>
            ) : null}
            {/* Hidden, not unmounted, in compact mode: the section keeps its state. */}
            {active ? (
              <div className={styles.content} hidden={compact}>
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
        {mode === 'narrow' ? <BottomNav {...nav} focusHeading={focusHeading} /> : null}
      </div>
    </ShellContext.Provider>
  );
}
