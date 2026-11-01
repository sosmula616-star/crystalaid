import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ width, height, className, style, ...rest }: SkeletonProps) {
  const size: CSSProperties = { ...(width !== undefined && { width }), ...(height !== undefined && { height }) };
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ ...size, ...style }}
    />
  );
}
