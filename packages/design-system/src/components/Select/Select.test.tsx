import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Select } from './Select.js';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('Select', () => {
  it('is named by its label and shows the selected option', () => {
    render(<Select label="Rank" value="b" onChange={() => {}} options={options} />);
    const trigger = screen.getByRole('combobox', { name: 'Rank' });
    expect(trigger.textContent).toContain('Beta');
  });

  it('selects an option with the keyboard', async () => {
    const onChange = vi.fn();
    render(<Select label="Rank" value="a" onChange={onChange} options={options} />);
    screen.getByRole('combobox', { name: 'Rank' }).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('hides the label visually but keeps the name', () => {
    render(<Select label="Rank" hideLabel value="a" onChange={() => {}} options={options} />);
    expect(screen.getByRole('combobox', { name: 'Rank' })).toBeTruthy();
    expect(screen.getByText('Rank').className).toMatch(/srOnly/);
  });

  it('rejects an option with an empty value', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<Select label="Rank" value="a" onChange={() => {}} options={[{ value: '', label: 'None' }]} />),
    ).toThrow(/value ""/);
    quiet.mockRestore();
  });

  it('has no a11y violations when open', async () => {
    render(<Select label="Rank" value="a" onChange={() => {}} options={options} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Rank' }));
    await screen.findByRole('listbox');
    await expectNoA11yViolations(document.body);
  });
});
