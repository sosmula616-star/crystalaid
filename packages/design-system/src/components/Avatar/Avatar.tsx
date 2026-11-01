import { useState, type HTMLAttributes } from 'react';
import styles from './Avatar.module.css';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: string;
  src?: string | null | undefined;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();
}

export function Avatar({ name, src, className, ...rest }: AvatarProps) {
  // Remember which src failed, so a new src gets another try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && src !== failedSrc;
  // Without a name the avatar carries no information, so it is hidden from assistive tech.
  const a11y = name.trim() ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true };
  return (
    <span {...rest} {...a11y} className={[styles.avatar, className].filter(Boolean).join(' ')}>
      {showImage ? (
        <img className={styles.image} src={src!} alt="" onError={() => setFailedSrc(src ?? null)} />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
