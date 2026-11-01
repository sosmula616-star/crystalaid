import { useId } from 'react';
import { Tooltip } from '@crystalaid/design-system';
import type { Translate } from './context.js';
import { GROUPS, type Section, type SectionId } from './sections.js';
import styles from './Nav.module.css';

export interface NavListProps {
  sections: readonly Section[];
  activeId: SectionId;
  onSelect: (id: SectionId) => void;
  t: Translate;
}

interface NavButtonProps extends NavListProps {
  section: Section;
  /** Icon only: the label stays for assistive technology and moves into a tooltip. */
  iconOnly?: boolean;
  layout: 'side' | 'bottom';
}

export function NavButton({ section, activeId, onSelect, t, iconOnly = false, layout }: NavButtonProps) {
  const Icon = section.icon;
  const label = t(section.labelKey);
  const button = (
    <button
      type="button"
      className={[styles.item, layout === 'side' ? styles.itemSide : styles.itemBottom].join(' ')}
      aria-current={section.id === activeId ? 'page' : undefined}
      onClick={() => onSelect(section.id)}
    >
      <Icon aria-hidden="true" focusable="false" size={20} />
      <span className={iconOnly ? styles.srOnly : styles.label}>{label}</span>
    </button>
  );
  return iconOnly ? <Tooltip content={label}>{button}</Tooltip> : button;
}

export interface NavGroupsProps extends NavListProps {
  iconOnly?: boolean;
}

/** Sections under the headings base, Curator and Admin. Empty groups are skipped. */
export function NavGroups({ sections, iconOnly = false, ...rest }: NavGroupsProps) {
  const prefix = useId();
  return (
    <>
      {GROUPS.map((level) => {
        const items = sections.filter((section) => section.minLevel === level);
        if (items.length === 0) return null;
        const headingId = `${prefix}-${level}`;
        return (
          <div key={level} className={styles.group}>
            <h2 id={headingId} className={iconOnly ? styles.srOnly : styles.heading}>
              {rest.t(`level.${level}`)}
            </h2>
            <ul className={styles.list} aria-labelledby={headingId}>
              {items.map((section) => (
                <li key={section.id}>
                  <NavButton {...rest} sections={sections} section={section} iconOnly={iconOnly} layout="side" />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export interface SideNavProps extends NavListProps {
  /** Medium widths show icons with tooltips, wide ones add the labels. */
  iconOnly: boolean;
}

export function SideNav({ iconOnly, t, ...rest }: SideNavProps) {
  return (
    <nav aria-label={t('shell.nav')} className={[styles.side, iconOnly ? styles.sideIcons : ''].join(' ')}>
      <NavGroups {...rest} t={t} iconOnly={iconOnly} />
    </nav>
  );
}
