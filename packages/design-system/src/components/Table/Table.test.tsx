import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Table, type TableColumn } from './Table.js';

interface Row {
  id: string;
  name: string;
  note: string;
  amount: number;
}

const columns: TableColumn<Row>[] = [
  { id: 'name', header: 'Name', render: (r) => r.name, priority: 'primary' },
  { id: 'amount', header: 'Amount', render: (r) => r.amount, priority: 'primary' },
  { id: 'note', header: 'Note', render: (r) => r.note, priority: 'secondary' },
];
const rows: Row[] = [
  { id: 'a', name: 'Alpha', note: 'first note', amount: 1 },
  { id: 'b', name: 'Beta', note: 'second note', amount: 2 },
];

const setup = (r: Row[] = rows) =>
  render(
    <Table columns={columns} rows={r} rowKey={(x) => x.id} empty="Nothing here" caption="People" expandLabel="Show details" />,
  );

describe('Table', () => {
  it('exposes caption, headers and row headers with explicit roles', () => {
    setup();
    expect(screen.getByRole('table', { name: 'People' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Name');
    const header = screen.getByRole('rowheader', { name: 'Alpha' });
    expect(header.tagName).toBe('TH');
    expect(header.getAttribute('scope')).toBe('row');
    expect(document.querySelectorAll('table')).toHaveLength(1);
  });

  it('renders every cell once and labels cells for the card view', () => {
    setup();
    expect(screen.getAllByText('first note')).toHaveLength(1);
    const amount = screen.getAllByRole('cell').find((c) => c.textContent === '1')!;
    expect(amount.getAttribute('data-label')).toBe('Amount');
  });

  it('shows empty content when there are no rows', () => {
    setup([]);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('expands a row and reports aria-expanded', async () => {
    setup();
    const [first, second] = screen.getAllByRole('button');
    const row = first!.closest('tr')!;
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(row.getAttribute('data-expanded')).toBe('false');
    await userEvent.click(first!);
    expect(first!.getAttribute('aria-expanded')).toBe('true');
    expect(second!.getAttribute('aria-expanded')).toBe('false');
    expect(row.getAttribute('data-expanded')).toBe('true');
    const controlled = document.getElementById(first!.getAttribute('aria-controls')!)!;
    expect(within(row).getByText('first note')).toBe(controlled);
    await userEvent.click(first!);
    expect(first!.getAttribute('aria-expanded')).toBe('false');
  });

  it('names the toggle after the row', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Show details Alpha' })).toBeTruthy();
  });

  it('has no toggle when there are no secondary columns', () => {
    render(
      <Table columns={columns.slice(0, 2)} rows={rows} rowKey={(x) => x.id} empty="-" caption="c" expandLabel="More" />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps long values and large numbers inside the container (wrap classes)', () => {
    const long = { id: 'x', name: 'x'.repeat(40), note: 'n', amount: 1000000000 };
    setup([long]);
    expect(screen.getByRole('rowheader').textContent).toBe('x'.repeat(40));
    const css = readFileSync(join(process.cwd(), 'packages/design-system/src/components/Table/Table.module.css'), 'utf8');
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/tabular-nums/);
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container \(max-width: 720px\)/);
    expect(css).toMatch(/overflow-x:\s*auto/);
  });

  it('has no a11y violations', async () => {
    const { container } = setup();
    await expectNoA11yViolations(container);
  });
});
