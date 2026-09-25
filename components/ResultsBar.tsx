"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

interface ResultsBarProps {
  showing: number;
  total: number;
  sortOptions: { value: string; label: string }[];
  /**
   * Which view is shown when the URL has no `view` param. Must match the
   * page's own default or the Grid/List labels highlight the wrong one —
   * jobs defaults to list, talent to grid.
   */
  defaultView?: "grid" | "list";
  /** 1-based index of the first row on this page; when set, renders a range ("1–40 of 645"). */
  from?: number;
}

export function ResultsBar({ showing, total, sortOptions, defaultView = "grid", from }: ResultsBarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentView = searchParams.get("view") || defaultView;
  const currentSort = searchParams.get("sort") || "";

  const makeHref = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    return `${pathname}?${p.toString()}`;
  };

  const handleSort = (e: React.ChangeEvent<HTMLSelectElement>) => {
    router.push(makeHref("sort", e.target.value));
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 mb-6"
      style={{ borderTop: "1px solid var(--divider)", borderBottom: "1px solid var(--divider)" }}
    >
      <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>
        {from !== undefined && total > showing
          ? <>Showing {from}–{from + showing - 1} of {total}</>
          : <>Showing {showing} of {total}</>}
      </p>
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] font-normal uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>Sort:</span>
          <select
            value={currentSort}
            onChange={handleSort}
            className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] bg-transparent border-none outline-none cursor-pointer appearance-none"
            style={{ color: "var(--text-1)" }}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="text-[11px] -ml-1" style={{ color: "var(--text-3)" }}>▾</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-normal uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>View:</span>
          <Link
            href={makeHref("view", "grid")}
            className={`font-mono text-[11px] font-normal uppercase tracking-[0.12em] transition-colors ${currentView === "grid" ? "" : "hover:text-[var(--text-1)]"}`}
            style={{ color: currentView === "grid" ? "var(--text-1)" : "var(--text-3)" }}
          >
            Grid
          </Link>
          <span className="text-[11px]" style={{ color: "var(--divider-strong)" }}>·</span>
          <Link
            href={makeHref("view", "list")}
            className={`font-mono text-[11px] font-normal uppercase tracking-[0.12em] transition-colors ${currentView === "list" ? "" : "hover:text-[var(--text-1)]"}`}
            style={{ color: currentView === "list" ? "var(--text-1)" : "var(--text-3)" }}
          >
            List
          </Link>
        </div>
      </div>
    </div>
  );
}
