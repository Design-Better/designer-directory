"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Job } from "@prisma/client";
import { CompanySquare } from "@/components/JobCard";
import { formatShortDate } from "@/lib/utils";

export interface JobRow {
  job: Job;
  /** Open roles this employer has on the board; drives the "Open roles" column. */
  companyCount?: number;
  /** The employer view (?company=) — where the name and the count link. */
  companyHref: string;
}

/**
 * The sticky nav's height, measured live. It changes with viewport width and
 * hard-coding it left a visible gap between nav and table header at some sizes.
 */
function useNavHeight(fallback = 69) {
  const [h, setH] = useState(fallback);
  useEffect(() => {
    const nav = document.querySelector("header");
    if (!nav) return;
    const update = () => setH(Math.round(nav.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  return h;
}

const TH = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-left px-3 py-3 whitespace-nowrap";
const TD = "px-3 py-3 align-middle";

/**
 * Dense list view for the jobs board. A real table rather than flex rows so
 * the columns line up across hundreds of entries and the header can stick
 * under the nav while scrolling. Columns drop out on narrow screens rather
 * than the table scrolling sideways, because a sticky header inside an
 * overflow container stops sticking.
 */
export function JobTable({ rows, showCompanyCount = true, sticky = true }: {
  rows: JobRow[];
  /** Hidden on an employer's own page, where every row would say the same number. */
  showCompanyCount?: boolean;
  /** Pin the header under the nav while scrolling. Off for short embedded tables (home page). */
  sticky?: boolean;
}) {
  const navHeight = useNavHeight();
  return (
    <table className="w-full border-collapse" style={{ background: "var(--surface-1)" }}>
      <thead
        className={sticky ? "sticky z-10" : undefined}
        style={{ top: sticky ? navHeight : undefined, background: "var(--bg)", boxShadow: "inset 0 -1px 0 var(--divider)" }}
      >
        <tr style={{ color: "var(--text-2)" }}>
          <th className={TH}>Role</th>
          <th className={`${TH} hidden sm:table-cell`}>Company</th>
          {showCompanyCount && <th className={`${TH} hidden sm:table-cell text-right`}>Open roles</th>}
          <th className={`${TH} hidden lg:table-cell`}>Category</th>
          <th className={`${TH} hidden md:table-cell`}>Location</th>
          <th className={`${TH} text-right`}>Posted</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ job, companyCount, companyHref }) => {
          const jobHref = `/jobs/${job.id}`;
          return (
            <tr
              key={job.id}
              className="animate-fade-in transition-colors duration-[120ms] hover:bg-[var(--surface-2)]"
              style={{ borderBottom: "1px solid var(--divider)" }}
            >
              {/* Title */}
              <td className={`${TD} min-w-0`}>
                <Link href={jobHref} className="group block">
                  <p className="font-display font-bold text-[15px] leading-tight transition-colors duration-[120ms] group-hover:text-[#FF4725]" style={{ color: "var(--text-1)" }}>
                    {job.featured && <span className="mr-1.5" style={{ color: "#FF4725" }}>★</span>}
                    {job.title}<span style={{ color: "#FF4725" }}>.</span>
                  </p>
                  {/* Company shows here on phones, where its own column is hidden by width */}
                  <p className="sm:hidden text-[12px] italic mt-0.5 truncate" style={{ color: "var(--text-3)" }}>{job.company}</p>
                </Link>
              </td>

              {/* Company */}
              <td className={`${TD} hidden sm:table-cell whitespace-nowrap`}>
                <Link
                  href={companyHref}
                  className="group inline-flex items-center gap-2.5 text-[13px] font-semibold transition-colors duration-[120ms]"
                  style={{ color: "var(--text-2)" }}
                >
                  <span className="block w-7 h-7 flex-shrink-0 relative overflow-hidden rounded-sm container-type-inline">
                    <CompanySquare companyLogoUrl={job.companyLogoUrl} company={job.company} compact />
                  </span>
                  <span className="group-hover:underline">{job.company}</span>
                </Link>
              </td>

              {/* Open roles at this employer */}
              {showCompanyCount && (
                <td className={`${TD} hidden sm:table-cell text-right whitespace-nowrap`}>
                  {companyCount !== undefined && companyCount > 1 ? (
                    <Link
                      href={companyHref}
                      className="inline-flex items-baseline gap-1 font-display font-bold text-[17px] leading-none hover:underline"
                      style={{ color: "#FF4725" }}
                      title={`See all ${companyCount} roles at ${job.company}`}
                    >
                      {companyCount}
                      <span className="font-mono font-normal text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--text-3)" }}>roles</span>
                    </Link>
                  ) : (
                    <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>—</span>
                  )}
                </td>
              )}

              {/* Category */}
              <td className={`${TD} hidden lg:table-cell whitespace-nowrap`}>
                <span className="font-mono text-[10px] font-normal uppercase tracking-[0.1em] px-2.5 py-1 rounded-full" style={{ background: "var(--surface-2)", color: "#FF4725" }}>
                  {job.role}
                </span>
              </td>

              {/* Location + remote */}
              <td className={`${TD} hidden md:table-cell`}>
                <div className="flex items-center gap-2 min-w-0">
                  {job.location && (
                    <span className="text-[12px] font-medium truncate max-w-[16rem]" style={{ color: "var(--text-2)" }}>{job.location}</span>
                  )}
                  {job.remote && (
                    <span className="font-mono text-[9px] font-normal uppercase tracking-[0.1em] rounded-full px-2 py-0.5 flex-shrink-0" style={{ border: "1px solid var(--divider-strong)", color: "var(--text-2)" }}>
                      Remote
                    </span>
                  )}
                </div>
              </td>

              {/* Posted */}
              <td className={`${TD} text-right whitespace-nowrap font-mono text-[11px]`} style={{ color: "var(--text-3)" }}>
                {formatShortDate(job.createdAt)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
