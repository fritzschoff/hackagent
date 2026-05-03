"use client";

import { useMemo, useState, type ReactNode } from "react";

export type PaginatedRow = { key: string; node: ReactNode };

export default function PaginatedList({
  rows,
  pageSize = 10,
  emptyMessage,
}: {
  rows: PaginatedRow[];
  pageSize?: number;
  emptyMessage: string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const slice = useMemo(
    () => rows.slice(start, start + pageSize),
    [rows, start, pageSize],
  );

  if (rows.length === 0) {
    return <p className="p-5 text-sm text-(--color-muted)">{emptyMessage}</p>;
  }

  return (
    <>
      <ul>
        {slice.map((r) => (
          <li
            key={r.key}
            className="px-5 py-3 border-b border-(--color-rule) last:border-0"
          >
            {r.node}
          </li>
        ))}
      </ul>
      {totalPages > 1 ? (
        <div className="flex items-center justify-between px-5 py-3 border-t border-(--color-rule) text-xs font-mono">
          <span className="text-(--color-muted)">
            page {safePage + 1} of {totalPages} · {rows.length} total
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="link disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage === totalPages - 1}
              className="link disabled:opacity-30 disabled:cursor-not-allowed"
            >
              next →
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
