import { useId, useState, type ReactNode } from 'react';
import styles from './Table.module.css';

export interface TableColumn<T> {
  id: string;
  header: string;
  render: (row: T) => ReactNode;
  priority: 'primary' | 'secondary';
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown instead of rows when there are none. */
  empty: ReactNode;
  caption: string;
  /** Accessible text of the per-row toggle that reveals secondary columns on narrow containers. */
  expandLabel: string;
  /** Column used as the row header; defaults to the first primary column. */
  rowHeaderId?: string;
}

/*
 * One real <table>. In containers narrower than 720px CSS turns rows into cards,
 * which drops native table semantics, so the roles are stated explicitly.
 */
export function Table<T>({ columns, rows, rowKey, empty, caption, expandLabel, rowHeaderId }: TableProps<T>) {
  const uid = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const headerColumn =
    columns.find((c) => c.id === rowHeaderId) ?? columns.find((c) => c.priority === 'primary') ?? columns[0];
  const secondary = columns.filter((c) => c.priority === 'secondary');
  const hasSecondary = secondary.length > 0;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className={styles.root}>
      <div className={styles.scroller}>
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
            {rows.map((row) => {
              const key = rowKey(row);
              const rid = `${uid}-${key}`;
              const expanded = open.has(key);
              const headerCellId = `${rid}-h`;
              return (
                <tr key={key} role="row" className={styles.row} data-expanded={expanded}>
                  {columns.map((c) =>
                    c === headerColumn ? (
                      <th
                        key={c.id}
                        id={headerCellId}
                        role="rowheader"
                        scope="row"
                        className={styles.td}
                        data-label={c.header}
                        data-priority={c.priority}
                      >
                        {c.render(row)}
                      </th>
                    ) : (
                      <td
                        key={c.id}
                        id={`${rid}-${c.id}`}
                        role="cell"
                        className={styles.td}
                        data-label={c.header}
                        data-priority={c.priority}
                      >
                        {c.render(row)}
                      </td>
                    ),
                  )}
                  {hasSecondary && (
                    <td role="cell" className={`${styles.td} ${styles.toggleCell}`}>
                      <button
                        type="button"
                        className={styles.toggle}
                        aria-expanded={expanded}
                        aria-controls={secondary.map((c) => `${rid}-${c.id}`).join(' ')}
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
      {rows.length === 0 && <div className={styles.empty}>{empty}</div>}
    </div>
  );
}
