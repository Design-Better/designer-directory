import { db } from "@/lib/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { Job } from "@prisma/client";
import { JobCard } from "@/components/JobCard";
import { JobTable } from "@/components/JobTable";
import { ResultsBar } from "@/components/ResultsBar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { PRIMARY_ROLES, EXPERIENCE_LEVELS } from "@/lib/utils";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";
import { getCorpusStats, formatSubscribers } from "@/lib/corpus";

interface SearchParams {
  role?: string;
  level?: string;
  type?: string;
  remote?: string;
  company?: string;
  sort?: string;
  view?: string;
  page?: string;
}

/**
 * "Design Leadership" lives in the Roles menu as a pseudo-role. It isn't a
 * discipline — it filters on the `leadership` flag across all of them — but
 * it's how job hunters think ("I want a leadership role"), and 77% of leadership
 * roles are Product Design anyway, so splitting it by discipline would leave
 * buckets too thin to be useful.
 */
const LEADERSHIP_ROLE = "leadership";

const SORT_OPTIONS = [
  { value: "", label: "BALANCED" },
  { value: "recent", label: "RECENTLY POSTED" },
  { value: "featured", label: "FEATURED FIRST" },
];

const PAGE_SIZE = 40;
/**
 * On the unfiltered browse, no employer shows more than this many roles.
 * Adobe alone has 34; without a cap the deep pages are just the ten biggest
 * employers cycling. Anyone who wants all of Adobe gets them at ?company=Adobe,
 * where the cap doesn't apply — nor does it apply once any filter is active,
 * because a search should be complete even if a browse is curated.
 */
const BROWSE_CAP_PER_EMPLOYER = 3;

async function getMatchingJobs(params: SearchParams): Promise<Job[]> {
  return db.job.findMany({
    where: {
      active: true,
      ...(params.role === LEADERSHIP_ROLE
        ? { leadership: true }
        : params.role ? { role: params.role } : {}),
      ...(params.level ? { experienceLevel: params.level } : {}),
      ...(params.type ? { typeOfRole: params.type } : {}),
      ...(params.remote === "true" ? { remote: true } : {}),
      ...(params.company ? { company: params.company } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

/**
 * Balanced order: rank each role within its employer by recency, then sort by
 * (rank, date). Every employer's newest role lands in the first pass, their
 * second-newest in the second pass, and so on. Fresh roles still surface first,
 * but no employer can occupy two adjacent slots. Deterministic — so pagination
 * is stable and a URL means the same thing tomorrow — which is why this beats
 * randomising.
 */
function balance(jobs: Job[], featuredFirst: boolean): Array<{ job: Job; rank: number }> {
  const seen = new Map<string, number>();
  const ranked = jobs.map((job) => {
    const key = job.company.trim().toLowerCase();
    const rank = (seen.get(key) ?? 0) + 1;
    seen.set(key, rank);
    return { job, rank };
  });
  ranked.sort((a, b) => {
    if (featuredFirst && a.job.featured !== b.job.featured) return a.job.featured ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return b.job.createdAt.getTime() - a.job.createdAt.getTime();
  });
  return ranked;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const { company } = await searchParams;
  if (company) {
    return {
      title: `${company} design jobs`,
      description: `Open design roles at ${company}, pulled daily from their careers site. Product, UX, brand, design systems and leadership roles on Design Better Careers.`,
      alternates: { canonical: `/jobs?company=${encodeURIComponent(company)}` },
    };
  }
  // Every other filter, sort and page variant canonicalises to the index.
  return {
    title: "Design jobs",
    description: "Hundreds of open design roles, pulled daily from company career pages: product design, UX, brand, design systems, research, motion and design leadership.",
    alternates: { canonical: "/jobs" },
  };
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [matching, boardTotal, corpusStats, companyRows] = await Promise.all([
    getMatchingJobs(params),
    db.job.count({ where: { active: true } }),
    getCorpusStats(),
    db.job.groupBy({ by: ["company"], where: { active: true }, _count: { _all: true } }),
  ]);
  const subscriberLabel = formatSubscribers(corpusStats?.subscribers);
  const companyCount = new Map(companyRows.map((r) => [r.company, r._count._all]));

  const hasFilter = Boolean(params.role || params.level || params.type || params.remote || params.company);
  const sort = params.sort ?? "";

  // Order, then cap (browse only), then page.
  let ordered: Job[];
  if (sort === "recent") {
    ordered = matching; // already newest-first from the query
  } else {
    const ranked = balance(matching, sort === "featured");
    ordered = (hasFilter ? ranked : ranked.filter((r) => r.rank <= BROWSE_CAP_PER_EMPLOYER)).map((r) => r.job);
  }
  const hiddenByCap = matching.length - ordered.length;

  // ?page=N shows the first N pages, not just the Nth: "Load more" is a soft
  // navigation to page N+1 that appends rows in place, and a shared ?page=3
  // link shows the same 120 rows the sharer was looking at.
  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, parseInt(params.page ?? "1", 10) || 1));
  const jobs = ordered.slice(0, page * PAGE_SIZE);
  const remaining = ordered.length - jobs.length;

  // Jobs default to the compact list: it fits far more roles on screen, which
  // matters now the board carries several hundred. `?view=grid` opts back in.
  const view = params.view === "grid" ? "grid" : "list";
  const activeFilters = Object.entries(params)
    .filter(([k]) => !["sort", "view", "page"].includes(k))
    .filter(([, v]) => Boolean(v)).length;

  /** Same URL with some params changed; drops the page unless asked to keep it. */
  const href = (overrides: Partial<Record<keyof SearchParams, string | undefined>>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...params, page: undefined, ...overrides })) {
      if (v) next[k] = v;
    }
    const qs = new URLSearchParams(next).toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  const heading = params.company ? params.company : "Open design roles";
  const subheading = params.company
    ? `${matching.length} open role${matching.length === 1 ? "" : "s"} · Design Better Careers`
    : "Jobs · Design Better Careers";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-24">

        {/* Hero */}
        <div className="flex items-end justify-between mb-10 pb-10" style={{ borderBottom: "1px solid var(--divider)" }}>
          <div>
            {params.company && (
              <Link
                href={href({ company: undefined })}
                className="inline-block font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-4 transition-colors duration-[120ms]"
                style={{ color: "var(--text-3)" }}
              >
                ← All employers
              </Link>
            )}
            <h1 className="font-display text-display-lg font-bold leading-none" style={{ color: "var(--text-1)" }}>
              {heading}<span style={{ color: "#FF4725" }}>.</span>
            </h1>
            <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mt-3" style={{ color: "var(--text-3)" }}>
              {subheading}
            </p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0 ml-8">
            <div className="text-right">
              <p className="font-display font-bold text-display-md leading-none" style={{ color: "#FF4725" }}>{boardTotal}</p>
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mt-1" style={{ color: "var(--text-3)" }}>Roles open</p>
            </div>
            <div className="hidden md:flex flex-col gap-2">
              <Link
                href="/post-a-job"
                className="inline-flex items-center gap-2 font-mono text-[11px] font-normal uppercase tracking-[0.12em] px-5 py-3 rounded-md transition-colors duration-[120ms] whitespace-nowrap"
                style={{ background: "#0A0A0A", color: "#F5F2EC" }}
              >
                Post a Job — ${JOB_POSTING_PRICE_DOLLARS} →
              </Link>
              <Link
                href="/jobs/manage"
                className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-center transition-colors duration-[120ms]"
                style={{ color: "var(--text-3)" }}
              >
                Manage a listing
              </Link>
            </div>
          </div>
        </div>

        {/* Filter row */}
        <form className="mb-8">
          {params.sort && <input type="hidden" name="sort" value={params.sort} />}
          {params.view && <input type="hidden" name="view" value={params.view} />}
          {params.company && <input type="hidden" name="company" value={params.company} />}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <JobFilterSelect label="Role" name="role" value={params.role || ""}>
              <option value="">All roles</option>
              <option value={LEADERSHIP_ROLE}>Design Leadership</option>
              <option disabled>──────────</option>
              {PRIMARY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </JobFilterSelect>

            <JobFilterSelect label="Experience" name="level" value={params.level || ""}>
              <option value="">All levels</option>
              {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </JobFilterSelect>

            <JobFilterSelect label="Type" name="type" value={params.type || ""}>
              <option value="">Any type</option>
              <option value="Full-time">Full-time</option>
              <option value="Contract">Contract</option>
              <option value="Part-time">Part-time</option>
            </JobFilterSelect>

            <div className="flex flex-col gap-1">
              <label className="font-mono text-[9px] font-normal uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>Remote</label>
              <label
                className="h-8 px-3 flex items-center gap-2 text-[11px] cursor-pointer uppercase tracking-wide font-medium transition-colors duration-[120ms]"
                style={{ border: "1px solid var(--input-border)", background: "var(--surface-1)", color: "var(--text-1)" }}
              >
                <input
                  type="checkbox"
                  name="remote"
                  value="true"
                  defaultChecked={params.remote === "true"}
                  className="rounded"
                />
                Remote only
              </label>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="h-8 px-4 font-mono text-[11px] font-normal uppercase tracking-[0.12em] transition-colors duration-[120ms]"
                style={{ background: "#0A0A0A", color: "#F5F2EC" }}
              >
                Filter
              </button>
              {activeFilters > 0 && (
                <>
                  <Link
                    href="/jobs"
                    className="h-8 px-3 font-mono text-[11px] font-normal uppercase tracking-[0.12em] transition-colors duration-[120ms] flex items-center"
                    style={{ color: "var(--text-3)" }}
                  >
                    Clear
                  </Link>
                  <Link
                    href={`/alerts/new?${new URLSearchParams(Object.fromEntries(Object.entries({ role: params.role === LEADERSHIP_ROLE ? undefined : params.role, leadership: params.role === LEADERSHIP_ROLE ? "true" : undefined, level: params.level, type: params.type, remote: params.remote, company: params.company }).filter(([, v]) => Boolean(v)) as [string, string][])).toString()}`}
                    className="h-8 px-3 font-mono text-[11px] font-normal uppercase tracking-[0.12em] transition-colors duration-[120ms] flex items-center"
                    style={{ border: "1px solid var(--input-border)", color: "var(--text-1)" }}
                    title="Save this search and get new matches by email (Design Better subscriber benefit)"
                  >
                    Email me these jobs
                  </Link>
                </>
              )}
            </div>
          </div>
        </form>

        {/* Results bar */}
        <Suspense>
          <ResultsBar
            showing={jobs.length}
            total={ordered.length}
            from={1}
            sortOptions={SORT_OPTIONS}
            defaultView="list"
          />
        </Suspense>

        {/* Grid / List */}
        {jobs.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-display font-bold text-display-sm" style={{ color: "var(--text-1)" }}>
              No roles match<span style={{ color: "#FF4725" }}>.</span>
            </p>
            <p className="text-sm mt-3" style={{ color: "var(--text-2)" }}>
              Try adjusting your filters or check back soon.
            </p>
            {activeFilters > 0 && (
              <Link
                href="/jobs"
                className="inline-block mt-6 font-mono text-[11px] font-normal uppercase tracking-[0.12em] px-5 py-2.5 rounded-md transition-colors duration-[120ms]"
                style={{ background: "var(--surface-1)", color: "var(--text-2)" }}
              >
                Clear filters
              </Link>
            )}
          </div>
        ) : view === "list" ? (
          <JobTable
            showCompanyCount={!params.company}
            rows={jobs.map((job) => ({
              job,
              companyCount: companyCount.get(job.company),
              companyHref: href({ company: job.company, role: undefined, level: undefined, type: undefined, remote: undefined }),
            }))}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}

        {/* Load more + note about capped employers */}
        {(remaining > 0 || hiddenByCap > 0) && (
          <div className="mt-8 flex flex-col items-center gap-4">
            {remaining > 0 && (
              <LoadMoreButton href={href({ page: String(page + 1) })} remaining={remaining} step={PAGE_SIZE} />
            )}
            {hiddenByCap > 0 && (
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-center" style={{ color: "var(--text-3)" }}>
                Showing up to {BROWSE_CAP_PER_EMPLOYER} roles per employer · {hiddenByCap} more via employer pages
              </p>
            )}
          </div>
        )}

        {/* Employer CTA */}
        <div className="mt-20 pt-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6" style={{ borderTop: "1px solid var(--divider)" }}>
          <div>
            <p className="font-display font-bold text-display-sm" style={{ color: "var(--text-1)" }}>
              Hiring a designer?<span style={{ color: "#FF4725" }}>.</span>
            </p>
            <p className="text-sm mt-2 max-w-md" style={{ color: "var(--text-2)" }}>
              Reach {subscriberLabel ?? "hundreds of thousands of"} design professionals and get a curated shortlist of matched candidates.
            </p>
          </div>
          <Link
            href="/post-a-job"
            className="flex-shrink-0 inline-flex items-center gap-2 font-mono text-[11px] font-normal uppercase tracking-[0.12em] px-6 py-3.5 rounded-md transition-colors duration-[120ms] whitespace-nowrap"
            style={{ background: "#0A0A0A", color: "#F5F2EC" }}
          >
            Post a Job — ${JOB_POSTING_PRICE_DOLLARS} →
          </Link>
        </div>
      </div>
    </div>
  );
}

function JobFilterSelect({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[9px] font-normal uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>
        {label}
      </label>
      <div className="relative">
        <select
          name={name}
          defaultValue={value}
          className="h-8 pl-2 pr-6 text-[11px] focus:outline-none appearance-none cursor-pointer uppercase tracking-wide font-medium"
          style={{ border: "1px solid var(--input-border)", background: "var(--surface-1)", color: "var(--text-1)" }}
        >
          {children}
        </select>
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: "var(--text-3)" }}>▾</span>
      </div>
    </div>
  );
}
