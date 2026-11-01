import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Tabs } from './Tabs.js';

const items = [
  { id: 'one', label: 'One', content: <p>First panel</p> },
  { id: 'two', label: 'Two', content: <p>Second panel</p> },
  { id: 'three', label: 'Three', content: <p>Third panel</p> },
];

function Harness() {
  const [value, setValue] = useState('one');
  return <Tabs items={items} value={value} onChange={setValue} />;
}

describe('Tabs', () => {
  it('shows the active panel', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('First panel');
  });

  it('switches with arrow keys', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'One' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Second panel');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches by click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Three' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Third panel');
  });

  it('has no a11y violations', async () => {
    const { container } = render(<Harness />);
    await expectNoA11yViolations(container);
  });
});
