import { createHash } from "node:crypto";
import type { Designer } from "@prisma/client";

/**
 * Paid-membership checks against db-community, per docs/custom-alerts-contract.md.
 *
 * Two calls, both behind MEMBERS_KEY:
 *   GET {MEMBERS_API_URL}/api/members/active-hashes → { hashes: string[], asOf }
 *   GET {MEMBERS_API_URL}/api/members/check?email=  → { entitled, status }
 *
 * The roster never arrives in the clear: db-community sends sha256 of each
 * lowercased, trimmed email and we hash ours the same way. The set is cached
 * for an hour; a failed refresh keeps the last good set.
 *
 * Two sources of truth, in order:
 *  1. The roster, when it is available. Re-checked every cron run.
 *  2. The status recorded on the designer at unlock (memberStatus,
 *     memberCheckedAt), trusted for RECORDED_STATUS_TTL_DAYS. This is what
 *     carries the feature until db-community ships its endpoints, and what
 *     keeps a community outage from pausing every paid alert.
 *
 * MEMBERS_STUB_EMAILS (comma list) stands in for the roster in development;
 * it is ignored once MEMBERS_API_URL is set.
 */

const TTL_MS = 60 * 60 * 1000;
const DAY = 864e5;
export const RECORDED_STATUS_TTL_DAYS = 30;

export type MemberStatus = "active" | "past_due" | "none";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export interface Roster {
  hashes: Set<string>;
  /** True only when the set came from db-community (or the dev stub); false means "no roster, fall back to recorded status". */
  available: boolean;
  asOf: string | null;
}

let cache: (Roster & { fetchedAt: number }) | null = null;

function stub(): Roster | null {
  const list = (process.env.MEMBERS_STUB_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? { hashes: new Set(list.map(hashEmail)), available: true, asOf: null } : null;
}

async function fetchRoster(): Promise<Roster> {
  const base = process.env.MEMBERS_API_URL;
  const key = process.env.MEMBERS_KEY;
  if (!base || !key) return stub() ?? { hashes: new Set(), available: false, asOf: null };
  const res = await fetch(`${base.replace(/\/$/, "")}/api/members/active-hashes`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`members roster ${res.status}`);
  const body = (await res.json()) as { hashes?: string[]; asOf?: string };
  if (!Array.isArray(body.hashes)) throw new Error("members roster: bad shape");
  return { hashes: new Set(body.hashes), available: true, asOf: body.asOf ?? null };
}

/** The member roster, refreshed at most hourly; last good set on failure. */
export async function memberRoster(): Promise<Roster> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache;
  try {
    cache = { ...(await fetchRoster()), fetchedAt: now };
  } catch {
    if (!cache) cache = { ...(stub() ?? { hashes: new Set(), available: false, asOf: null }), fetchedAt: now };
  }
  return cache;
}

type MemberFields = Pick<Designer, "email" | "memberEmail" | "memberStatus" | "memberCheckedAt">;

/**
 * Is this designer a paying member right now? Roster first; recorded status
 * (from a live check at unlock) when there is no roster to ask.
 */
export function isMember(d: MemberFields, roster: Roster, now = new Date()): boolean {
  if (roster.available) {
    return [d.email, d.memberEmail].some((e) => e && roster.hashes.has(hashEmail(e)));
  }
  const fresh = d.memberCheckedAt && now.getTime() - d.memberCheckedAt.getTime() < RECORDED_STATUS_TTL_DAYS * DAY;
  return Boolean(fresh && (d.memberStatus === "active" || d.memberStatus === "past_due"));
}

/**
 * Point check for the moment of unlock, when a brand-new subscriber may not be
 * in the hourly set yet. Uses the live endpoint when configured, else the
 * roster/stub. `live: false` with `entitled: false` means "we could not ask",
 * which the UI should phrase as "couldn't find" rather than "not a member".
 */
export async function checkMember(email: string): Promise<{ entitled: boolean; status: MemberStatus; live: boolean }> {
  const base = process.env.MEMBERS_API_URL;
  const key = process.env.MEMBERS_KEY;
  if (base && key) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/members/check?email=${encodeURIComponent(normalizeEmail(email))}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { entitled?: boolean; status?: string | null };
        const status: MemberStatus = body.status === "active" || body.status === "past_due" ? body.status : "none";
        return { entitled: Boolean(body.entitled), status, live: true };
      }
    } catch { /* fall through */ }
  }
  const roster = await memberRoster();
  const entitled = roster.available && roster.hashes.has(hashEmail(email));
  return { entitled, status: entitled ? "active" : "none", live: roster.available };
}
