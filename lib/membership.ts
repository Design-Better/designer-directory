import { createHash } from "node:crypto";

/**
 * Paid-membership checks against db-community, per docs/custom-alerts-contract.md.
 *
 * Two calls, both behind MEMBERS_KEY:
 *   GET {MEMBERS_API_URL}/api/members/active-hashes → { hashes: string[], asOf }
 *   GET {MEMBERS_API_URL}/api/members/check?email=  → { entitled, status }
 *
 * The roster never arrives in the clear: db-community sends sha256 of each
 * lowercased, trimmed email, and we hash ours the same way. The set is cached
 * for an hour; a failed refresh keeps the last good set, so a community outage
 * degrades to "slightly stale", never to "everyone unpaid".
 *
 * Until db-community ships the endpoints, MEMBERS_STUB_EMAILS (comma list) lets
 * the flow be exercised end to end; it is ignored once MEMBERS_API_URL is set.
 */

const TTL_MS = 60 * 60 * 1000;

export type MemberStatus = "active" | "past_due" | "none";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

let cache: { hashes: Set<string>; fetchedAt: number; asOf: string | null } | null = null;

function stubSet(): Set<string> {
  const list = (process.env.MEMBERS_STUB_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(list.map(hashEmail));
}

async function fetchRoster(): Promise<{ hashes: Set<string>; asOf: string | null }> {
  const base = process.env.MEMBERS_API_URL;
  const key = process.env.MEMBERS_KEY;
  if (!base || !key) return { hashes: stubSet(), asOf: null };
  const res = await fetch(`${base.replace(/\/$/, "")}/api/members/active-hashes`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`members roster ${res.status}`);
  const body = (await res.json()) as { hashes?: string[]; asOf?: string };
  if (!Array.isArray(body.hashes)) throw new Error("members roster: bad shape");
  return { hashes: new Set(body.hashes), asOf: body.asOf ?? null };
}

/** The active-member hash set, refreshed at most hourly; stale on failure. */
export async function activeMemberHashes(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.hashes;
  try {
    const fresh = await fetchRoster();
    cache = { ...fresh, fetchedAt: now };
  } catch {
    if (!cache) cache = { hashes: stubSet(), fetchedAt: now, asOf: null };
    // else: keep the last good set and try again next call
  }
  return cache.hashes;
}

/** Bulk check for the cron: true when any of the designer's addresses is on the roster. */
export async function isMemberBulk(emails: Array<string | null | undefined>, set: Set<string>): Promise<boolean> {
  return emails.some((e) => e && set.has(hashEmail(e)));
}

/**
 * Point check for the moment of unlock, when a brand-new subscriber may not be
 * in the hourly set yet. Falls back to the set when the endpoint is missing.
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
    } catch { /* fall through to the cached set */ }
  }
  const set = await activeMemberHashes();
  const entitled = set.has(hashEmail(email));
  return { entitled, status: entitled ? "active" : "none", live: false };
}
