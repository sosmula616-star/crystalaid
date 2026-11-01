import { useId, useState, type ReactNode } from 'react';
import styles from './Table.module.css';

export interface TableColumn<T> {
  id: string;
  header: string;
  render: (row: T) => ReactNode;
  priority: 'primary' | 'secondary';
}

export interface TableProps<T> {
  /** The first primary column is the row header; at least one column must be primary. */
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown instead of the table when there are no rows. */
  empty: ReactNode;
  caption: string;
  /** Accessible text of the per-row toggle that reveals secondary columns on narrow containers. */
  expandLabel: string;
}

/*
 * One real <table>. In containers narrower than 720px CSS turns rows into cards,
 * which drops native table semantics, so the roles are stated explicitly.
 * The root needs a definite inline size from its parent (block or grid/flex item
 * with min-width: 0) for the container query to measure.
 * Generated ids use row and column indexes, so keys with spaces or colliding
 * column ids cannot break id lists.
 */
export function Table<T>({ columns, rows, rowKey, empty, caption, expandLabel }: TableProps<T>) {
  const uid = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const headerColumn = columns.find((c) => c.priority === 'primary');
  if (!headerColumn) throw new Error('Table needs at least one column with priority "primary".');
  const hasSecondary = columns.some((c) => c.priority === 'secondary');
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  if (rows.length === 0) return <div className={styles.empty}>{empty}</div>;

  return (
    <div className={styles.root}>
      <div className={styles.scroller} role="region" aria-label={caption} tabIndex={0}>
        <table className={styles.table} role="table">
          <caption className={styles.caption}>{caption}</caption>
          <thead role="rowgroup" className={styles.head}>
            <tr role="row">
              {columns.map((c) => (
                <th key={c.id} role="columnheader" scope="col" className={styles.th}>
                  {c.header}
                </th>
              ))}
              {hasSecondary && (
                <th role="columnheader" scope="col" className={`${styles.th} ${styles.toggleCell}`}>
                  <span className={styles.srOnly}>{expandLabel}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row, rowIndex) => {
              const key = rowKey(row);
              const rid = `${uid}-r${rowIndex}`;
              const expanded = open.has(key);
              const headerCellId = `${rid}-h`;
              const secondaryIds: string[] = [];
              const cells = columns.map((c, colIndex) => {
                if (c === headerColumn) {
                  return (
                    <th
                      key={c.id}
                      id={headerCellId}
                      role="rowheader"
                      scope="row"
                      className={styles.td}
                      data-label={c.header}
                    >
                      {c.render(row)}
                    </th>
                  );
                }
                const isSecondary = c.priority === 'secondary';
                const id = `${rid}-c${colIndex}`;
                if (isSecondary) secondaryIds.push(id);
                return (
                  <td
                    key={c.id}
                    id={id}
                    role="cell"
                    className={isSecondary && !expanded ? `${styles.td} ${styles.collapsed}` : styles.td}
                    data-label={c.header}
                  >
                    {c.render(row)}
                  </td>
                );
              });
              return (
                <tr key={key} role="row" className={styles.row} data-expanded={expanded}>
                  {cells}
                  {hasSecondary && (
                    <td role="cell" className={`${styles.td} ${styles.toggleCell}`}>
                      <button
                        type="button"
                        className={styles.toggle}
                        aria-expanded={expanded}
                        aria-controls={secondaryIds.join(' ')}
                        aria-labelledby={`${rid}-lbl ${headerCellId}`}
                        onClick={() => toggle(key)}
                      >
                        <span id={`${rid}-lbl`} className={styles.srOnly}>
                          {expandLabel}
                        </span>
                        <span aria-hidden="true" className={styles.chevron} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
