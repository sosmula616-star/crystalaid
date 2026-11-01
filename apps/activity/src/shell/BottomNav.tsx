import { useLayoutEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { MoreDrawer } from './MoreDrawer.js';
import { NavButton, type NavListProps } from './SideNav.js';
import styles from './Nav.module.css';

/** The first four sections go in the bar; the rest are behind "More". */
const BAR_SLOTS = 4;

/** Lifts the toasts above the bar while it is shown. */
const TOAST_OFFSET = '--toast-bottom-offset';

export function BottomNav({ sections, activeId, onSelect, t, focusHeading }: NavListProps & { focusHeading: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inBar = sections.slice(0, BAR_SLOTS);
  const rest = sections.slice(BAR_SLOTS);
  const restActive = rest.some((section) => section.id === activeId);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(TOAST_OFFSET, `${bar.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TOAST_OFFSET);
    };
  }, []);

  return (
    <>
      <nav ref={barRef} aria-label={t('shell.nav')} className={styles.bottom}>
        <ul className={styles.bar}>
          {inBar.map((section) => (
            <li key={section.id}>
              <NavButton
                sections={sections}
                section={section}
                activeId={activeId}
                onSelect={onSelect}
                t={t}
                layout="bottom"
              />
            </li>
          ))}
          {rest.length > 0 ? (
            <li>
              <button
                ref={moreRef}
                type="button"
                className={[styles.item, styles.itemBottom].join(' ')}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                data-active={restActive || undefined}
                onClick={() => setMoreOpen(true)}
              >
                <Ellipsis aria-hidden="true" focusable="false" size={20} />
                <span className={styles.label}>{t('shell.more')}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
      <MoreDrawer
        open={moreOpen}
        onOpenChange={setMoreOpen}
        sections={rest}
        activeId={activeId}
        onSelect={onSelect}
        t={t}
        returnFocusRef={moreRef}
        focusHeading={focusHeading}
      />
    </>
  );
}
