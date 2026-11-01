import { forwardRef, type HTMLAttributes } from 'react';
import styles from './Card.module.css';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ className, ...rest }, ref) {
  return <div {...rest} ref={ref} className={[styles.card, className].filter(Boolean).join(' ')} />;
});
