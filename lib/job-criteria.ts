import type { Job } from "@prisma/client";
import { PRIMARY_ROLES, EXPERIENCE_LEVELS, ROLE_TYPES } from "@/lib/utils";
import { parseSalary } from "@/lib/job-posting-ld";

/**
 * Saved-search criteria for custom alerts. Same parameter names and values as
 * /api/v1/jobs, so a filtered board URL on designbetter.com is an alert, and
 * there is one vocabulary to validate. Applied as hard filters *before*
 * scoreDesigner ranks what survives, so the employer-side ranking and the
 * designer-side alert can never disagree about the same job.
 */

export interface Criteria {
  q?: string;
  role?: string[];
  level?: string[];
  type?: string[];
  company?: string[];
  location?: string;
  remote?: boolean;
  leadership?: boolean;
  salary?: boolean;
  /** Annual floor in the job's own currency; compared only when pay parses. */
  salaryMin?: number;
}

function list(v: string | null | undefined): string[] | undefined {
  const out = v?.split(",").map((s) => s.trim()).filter(Boolean);
  return out?.length ? out : undefined;
}
function bool(v: string | null | undefined): boolean | undefined {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/** Parse from a URLSearchParams (the /alerts/new entry) or a stored JSON object. */
export function parseCriteria(src: URLSearchParams | Record<string, unknown>): Criteria {
  const get = (k: string): string | undefined => {
    if (src instanceof URLSearchParams) return src.get(k) ?? undefined;
    const v = src[k];
    if (Array.isArray(v)) return v.join(",");
    return v === undefined || v === null ? undefined : String(v);
  };
  const c: Criteria = {
    q: get("q")?.trim() || undefined,
    role: list(get("role"))?.filter((r) => (PRIMARY_ROLES as readonly string[]).includes(r)),
    level: list(get("level"))?.filter((l) => (EXPERIENCE_LEVELS as readonly string[]).includes(l)),
    type: list(get("type"))?.filter((t) => (ROLE_TYPES as readonly string[]).includes(t)),
    company: list(get("company")),
    location: get("location")?.trim() || undefined,
    remote: bool(get("remote")),
    leadership: bool(get("leadership")),
    salary: bool(get("salary")),
    salaryMin: (() => { const n = Number(get("salaryMin")); return Number.isFinite(n) && n > 0 ? n : undefined; })(),
  };
  for (const k of Object.keys(c) as Array<keyof Criteria>) {
    const v = c[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete c[k];
  }
  return c;
}

export function isEmptyCriteria(c: Criteria): boolean {
  return Object.keys(c).length === 0;
}

export function matchesCriteria(job: Job, c: Criteria): boolean {
  if (c.role && !c.role.includes(job.role)) return false;
  if (c.level && !c.level.includes(job.experienceLevel)) return false;
  if (c.type && !c.type.includes(job.typeOfRole)) return false;
  if (c.company && !c.company.some((n) => n.toLowerCase() === job.company.trim().toLowerCase())) return false;
  if (c.location && !job.location.toLowerCase().includes(c.location.toLowerCase())) return false;
  if (c.remote !== undefined && job.remote !== c.remote) return false;
  if (c.leadership !== undefined && job.leadership !== c.leadership) return false;
  if (c.salary === true && !job.compensation) return false;
  if (c.salaryMin) {
    const pay = parseSalary(job.compensation);
    if (!pay || pay.unitText !== "YEAR" || pay.maxValue < c.salaryMin) return false;
  }
  if (c.q) {
    const q = c.q.toLowerCase();
    const hay = `${job.title} ${job.company} ${job.description ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Human label for an alert built from its criteria: "Senior · Product Design · Remote · pay listed". */
export function describeCriteria(c: Criteria): string {
  const parts: string[] = [];
  if (c.level) parts.push(c.level.map((l) => l.replace(/\s*\(.*\)/, "")).join("/"));
  if (c.role) parts.push(c.role.join("/"));
  if (c.leadership) parts.push("Leadership");
  if (c.type) parts.push(c.type.join("/"));
  if (c.company) parts.push(c.company.join(", "));
  if (c.location) parts.push(c.location);
  if (c.remote) parts.push("Remote");
  if (c.salaryMin) parts.push(`${Math.round(c.salaryMin / 1000)}k+`);
  else if (c.salary) parts.push("pay listed");
  if (c.q) parts.push(`"${c.q}"`);
  return parts.length ? parts.join(" · ") : "All design roles";
}

/** Canonical query string for a criteria object, for links back to the board and the API. */
export function criteriaToQuery(c: Criteria): string {
  const p = new URLSearchParams();
  if (c.q) p.set("q", c.q);
  if (c.role) p.set("role", c.role.join(","));
  if (c.level) p.set("level", c.level.join(","));
  if (c.type) p.set("type", c.type.join(","));
  if (c.company) p.set("company", c.company.join(","));
  if (c.location) p.set("location", c.location);
  if (c.remote !== undefined) p.set("remote", String(c.remote));
  if (c.leadership !== undefined) p.set("leadership", String(c.leadership));
  if (c.salary !== undefined) p.set("salary", String(c.salary));
  if (c.salaryMin) p.set("salaryMin", String(c.salaryMin));
  return p.toString();
}
