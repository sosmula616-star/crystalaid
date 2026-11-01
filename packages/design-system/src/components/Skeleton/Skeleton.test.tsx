import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('is hidden from assistive tech and applies size', () => {
    const { container } = render(<Skeleton width={120} height="2rem" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('2rem');
  });

  it('has no a11y violations', async () => {
    const { container } = render(<Skeleton />);
    await expectNoA11yViolations(container);
  });
});
