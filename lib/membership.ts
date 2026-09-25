import type { Designer } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Paid-membership checks against db-community (designbetter.community).
 * Careers never talks to Stripe or Substack; it asks the community app.
 *
 * Two calls, both with `Authorization: Bearer MEMBERS_KEY`:
 *   POST {MEMBERS_API_URL}/api/members/entitlement  { emails: [...≤500] }
 *        → { asOf, count, results: [{ email, entitled, status, plan }] }
 *        Local data only, results in the order sent. Used by the cron and for
 *        a first look on the page.
 *   GET  {MEMBERS_API_URL}/api/members/check?email=
 *        → { entitled, status, plan }. Falls back to Stripe, so it sees a
 *        subscriber who joined minutes ago. Used at the moment of unlock.
 * Rate limit on db-community's side: 30 requests a minute.
 *
 * Failure policy is fail-open: when db-community can't be reached, the status
 * recorded on the designer (memberStatus, memberCheckedAt) is trusted for
 * RECORDED_STATUS_TTL_DAYS. The cron refreshes that record every run, so an
 * outage never pauses a paying member's alerts.
 *
 * memberStatus "granted" is a manual grant from the admin route. Community
 * answers never overwrite it; it lasts RECORDED_STATUS_TTL_DAYS from the grant.
 *
 * MEMBERS_STUB_EMAILS (comma list) stands in for db-community in development;
 * it is ignored once MEMBERS_API_URL and MEMBERS_KEY are set.
 */

const DAY = 864e5;
const BATCH = 500;
export const RECORDED_STATUS_TTL_DAYS = 30;

export type MemberStatus = "active" | "past_due" | "none";
export type MemberPlan = "annual" | "monthly" | "comp" | "gift" | null;
export interface Entitlement { entitled: boolean; status: MemberStatus; plan: MemberPlan }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function config(): { base: string; key: string } | null {
  const base = process.env.MEMBERS_API_URL;
  const key = process.env.MEMBERS_KEY;
  return base && key ? { base: base.replace(/\/$/, ""), key } : null;
}

function toEntitlement(r: { entitled?: unknown; status?: unknown; plan?: unknown }): Entitlement {
  const status: MemberStatus = r.status === "active" || r.status === "past_due" ? r.status : "none";
  const plan = (["annual", "monthly", "comp", "gift"] as const).find((p) => p === r.plan) ?? null;
  return { entitled: r.entitled === true, status, plan };
}

function stub(emails: string[]): Map<string, Entitlement> | null {
  const list = new Set((process.env.MEMBERS_STUB_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean));
  if (!list.size) return null;
  return new Map(emails.map((e) => [e, list.has(e)
    ? { entitled: true, status: "active" as const, plan: "annual" as const }
    : { entitled: false, status: "none" as const, plan: null }]));
}

/**
 * Batch lookup, keyed by normalized email. Returns null when db-community
 * can't be asked (not configured, down, bad shape), so callers fall back to
 * the recorded status instead of treating everyone as lapsed.
 */
export async function entitlements(emails: string[]): Promise<Map<string, Entitlement> | null> {
  const unique = [...new Set(emails.filter(Boolean).map(normalizeEmail))];
  const cfg = config();
  if (!cfg) return stub(unique);
  const out = new Map<string, Entitlement>();
  try {
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      const res = await fetch(`${cfg.base}/api/members/entitlement`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ emails: chunk }),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`members entitlement ${res.status}`);
      const body = (await res.json()) as { results?: Array<{ entitled?: unknown; status?: unknown; plan?: unknown }> };
      if (!Array.isArray(body.results) || body.results.length !== chunk.length) throw new Error("members entitlement: bad shape");
      // Results come back in the order sent; zip by position.
      chunk.forEach((e, j) => out.set(e, toEntitlement(body.results![j])));
    }
    return out;
  } catch (e) {
    console.error("[membership]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Live point check for the moment of unlock (db-community falls back to
 * Stripe). `live: false` means "we could not ask", which the UI phrases as
 * "couldn't reach" rather than "not a member".
 */
export async function checkMember(email: string): Promise<Entitlement & { live: boolean }> {
  const e = normalizeEmail(email);
  const cfg = config();
  if (cfg) {
    try {
      const res = await fetch(`${cfg.base}/api/members/check?email=${encodeURIComponent(e)}`, {
        headers: { Authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.ok) return { ...toEntitlement(await res.json()), live: true };
    } catch { /* fall through to the batch lookup */ }
  }
  const hit = (await entitlements([e]))?.get(e);
  return hit ? { ...hit, live: true } : { entitled: false, status: "none", plan: null, live: false };
}

type MemberFields = Pick<Designer, "email" | "memberEmail" | "memberStatus" | "memberCheckedAt">;

function addresses(d: MemberFields): string[] {
  return [d.email, d.memberEmail].filter((e): e is string => Boolean(e)).map(normalizeEmail);
}

function recordedMember(d: MemberFields, now: Date): boolean {
  const fresh = d.memberCheckedAt && now.getTime() - d.memberCheckedAt.getTime() < RECORDED_STATUS_TTL_DAYS * DAY;
  return Boolean(fresh && (d.memberStatus === "active" || d.memberStatus === "past_due" || d.memberStatus === "granted"));
}

function grantedMember(d: MemberFields, now: Date): boolean {
  return d.memberStatus === "granted" && recordedMember(d, now);
}

/**
 * Is this designer a paying member? `ents` is a batch result (or null when
 * db-community couldn't be asked). Either address counts. A manual grant
 * always counts while fresh.
 */
export function isMember(d: MemberFields, ents: Map<string, Entitlement> | null, now = new Date()): boolean {
  if (grantedMember(d, now)) return true;
  if (!ents) return recordedMember(d, now);
  return addresses(d).some((e) => ents.get(e)?.entitled);
}

/**
 * The best answer for a status to record on the designer after a batch
 * lookup, or null to leave the record alone (grant, or no answer).
 */
export function statusToRecord(d: MemberFields, ents: Map<string, Entitlement> | null, now = new Date()): MemberStatus | null {
  if (!ents || grantedMember(d, now)) return null;
  const hits = addresses(d).map((e) => ents.get(e)).filter((x): x is Entitlement => Boolean(x));
  if (!hits.length) return null;
  return hits.find((h) => h.entitled)?.status ?? "none";
}

/**
 * Full check for the unlock flow (page and save action): batch lookup, then a
 * live check on each address, then the recorded status if db-community
 * couldn't be reached at all. Records what it learns on the designer.
 */
export async function resolveMember(d: MemberFields & { id: string }): Promise<{ entitled: boolean; live: boolean }> {
  const now = new Date();
  if (grantedMember(d, now)) return { entitled: true, live: true };
  const record = (memberStatus: MemberStatus) =>
    db.designer.update({ where: { id: d.id }, data: { memberStatus, memberCheckedAt: now } });

  const ents = await entitlements(addresses(d));
  if (isMember(d, ents, now) && ents) {
    await record(statusToRecord(d, ents, now) ?? "active");
    return { entitled: true, live: true };
  }
  let live = Boolean(ents);
  for (const e of addresses(d)) {
    const c = await checkMember(e);
    live ||= c.live;
    if (c.entitled) {
      await record(c.status === "none" ? "active" : c.status);
      return { entitled: true, live: true };
    }
  }
  if (!live) return { entitled: recordedMember(d, now), live: false };
  await record("none");
  return { entitled: false, live: true };
}
