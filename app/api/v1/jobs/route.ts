import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withTracking } from "@/lib/apply-url";
import { PRIMARY_ROLES, EXPERIENCE_LEVELS, ROLE_TYPES } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/v1/jobs — public, read-only JSON feed of active design roles for
 * other agents and tools. Documented in docs/jobs-api.md.
 *
 * Public because the same data is public on /jobs; CDN-cached for five
 * minutes so a chatty consumer can't reach the database; CORS open so
 * browser-hosted agents can call it. Every job carries `url` (our page, for
 * attribution) and `applyUrl` (the employer's posting with our UTMs, so the
 * employer still sees Design Better as the source).
 */

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const CACHE = "public, s-maxage=300, stale-while-revalidate=3600";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SORTS = ["newest", "oldest", "balanced"] as const;
type Sort = (typeof SORTS)[number];

function list(v: string | null): string[] | undefined {
  const out = v?.split(",").map((s) => s.trim()).filter(Boolean);
  return out?.length ? out : undefined;
}
function bool(v: string | null): boolean | undefined {
  if (v === null || v === "") return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}
/** "7d", "24h", or an ISO date → Date; undefined when absent or unparseable. */
function since(v: string | null): Date | undefined {
  if (!v) return undefined;
  const m = v.match(/^(\d+)([dh])$/);
  if (m) return new Date(Date.now() - Number(m[1]) * (m[2] === "d" ? 864e5 : 36e5));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function invalid(values: string[] | undefined, allowed: readonly string[]): string[] {
  return (values ?? []).filter((v) => !allowed.includes(v));
}

function count<T extends string>(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key]);
    out[k as T] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

  const filters = {
    q: p.get("q")?.trim() || undefined,
    role: list(p.get("role")),
    level: list(p.get("level")),
    type: list(p.get("type")),
    company: list(p.get("company")),
    location: p.get("location")?.trim() || undefined,
    remote: bool(p.get("remote")),
    leadership: bool(p.get("leadership")),
    salary: bool(p.get("salary")),
    since: since(p.get("since")),
    sort: (SORTS as readonly string[]).includes(p.get("sort") ?? "") ? (p.get("sort") as Sort) : "newest",
    limit: Math.min(MAX_LIMIT, Math.max(1, parseInt(p.get("limit") ?? "", 10) || DEFAULT_LIMIT)),
    offset: Math.max(0, parseInt(p.get("offset") ?? "", 10) || 0),
    include: new Set(list(p.get("include")) ?? []),
  };

  const bad = {
    role: invalid(filters.role, PRIMARY_ROLES),
    level: invalid(filters.level, EXPERIENCE_LEVELS),
    type: invalid(filters.type, ROLE_TYPES),
  };
  if (bad.role.length || bad.level.length || bad.type.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unknown filter value",
        invalid: bad,
        allowed: { role: PRIMARY_ROLES, level: EXPERIENCE_LEVELS, type: ROLE_TYPES, sort: SORTS },
      },
      { status: 400, headers: CORS },
    );
  }

  const where: Prisma.JobWhereInput = {
    active: true,
    ...(filters.role ? { role: { in: filters.role } } : {}),
    ...(filters.level ? { experienceLevel: { in: filters.level } } : {}),
    ...(filters.type ? { typeOfRole: { in: filters.type } } : {}),
    ...(filters.remote !== undefined ? { remote: filters.remote } : {}),
    ...(filters.leadership !== undefined ? { leadership: filters.leadership } : {}),
    ...(filters.salary === true ? { compensation: { not: null } } : filters.salary === false ? { compensation: null } : {}),
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
    ...(filters.location ? { location: { contains: filters.location, mode: "insensitive" } } : {}),
    ...(filters.company
      ? { OR: filters.company.map((c) => ({ company: { equals: c, mode: "insensitive" as const } })) }
      : {}),
    ...(filters.q
      ? {
          AND: [
            {
              OR: [
                { title: { contains: filters.q, mode: "insensitive" } },
                { company: { contains: filters.q, mode: "insensitive" } },
                { description: { contains: filters.q, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
  };

  const wantDescription = filters.include.has("description");

  // The whole matching set is small (the board carries under a thousand
  // roles), so fetch it once and do facets, balanced sort and paging in memory.
  const rows = await db.job.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true, title: true, company: true, companyUrl: true, companyLogoUrl: true, location: true,
      remote: true, role: true, experienceLevel: true, typeOfRole: true, compensation: true,
      leadership: true, visaSponsorship: true, featured: true, createdAt: true, expiresAt: true,
      jobUrl: true, companySize: true, description: wantDescription,
    },
  });

  let ordered = rows;
  if (filters.sort === "oldest") ordered = [...rows].reverse();
  if (filters.sort === "balanced") {
    // Rank each role within its employer by recency, then order by (rank, date):
    // no employer occupies adjacent slots. Same rule as the /jobs page default.
    const seen = new Map<string, number>();
    ordered = rows
      .map((job) => {
        const key = job.company.trim().toLowerCase();
        const rank = (seen.get(key) ?? 0) + 1;
        seen.set(key, rank);
        return { job, rank };
      })
      .sort((a, b) => a.rank - b.rank || b.job.createdAt.getTime() - a.job.createdAt.getTime())
      .map((r) => r.job);
  }

  const page = ordered.slice(filters.offset, filters.offset + filters.limit);
  const nextOffset = filters.offset + page.length < ordered.length ? filters.offset + page.length : null;

  const companies = count(rows, "company");
  const facets = {
    role: count(rows, "role"),
    experienceLevel: count(rows, "experienceLevel"),
    typeOfRole: count(rows, "typeOfRole"),
    remote: count(rows, "remote"),
    leadership: count(rows, "leadership"),
    hasSalary: { true: rows.filter((r) => r.compensation).length, false: rows.filter((r) => !r.compensation).length },
    company: Object.fromEntries(Object.entries(companies).slice(0, 25)),
    companiesTotal: Object.keys(companies).length,
  };

  const jobs = page.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    companyUrl: j.companyUrl,
    companyLogoUrl: j.companyLogoUrl,
    companySize: j.companySize,
    location: j.location,
    remote: j.remote,
    role: j.role,
    experienceLevel: j.experienceLevel,
    typeOfRole: j.typeOfRole,
    compensation: j.compensation,
    leadership: j.leadership,
    visaSponsorship: j.visaSponsorship,
    featured: j.featured,
    postedAt: j.createdAt.toISOString(),
    expiresAt: j.expiresAt ? j.expiresAt.toISOString() : null,
    url: `${base}/jobs/${j.id}`,
    applyUrl: withTracking(j.jobUrl) ?? j.jobUrl,
    ...(wantDescription ? { description: j.description ?? null } : {}),
  }));

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      total: ordered.length,
      count: jobs.length,
      limit: filters.limit,
      offset: filters.offset,
      nextOffset,
      filters: {
        q: filters.q ?? null, role: filters.role ?? null, level: filters.level ?? null, type: filters.type ?? null,
        company: filters.company ?? null, location: filters.location ?? null,
        remote: filters.remote ?? null, leadership: filters.leadership ?? null, salary: filters.salary ?? null,
        since: filters.since?.toISOString() ?? null, sort: filters.sort, include: [...filters.include],
      },
      facets,
      jobs,
    },
    { headers: { "Cache-Control": CACHE, ...CORS } },
  );
}
