import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import {
  scoreDesigner,
  MATCH_THRESHOLD,
  type DesignerForMatching,
  type JobForMatching,
} from "@/lib/matching";
import type { AlertFrequency, Designer, Job, JobAlert } from "@prisma/client";
import { parseCriteria, matchesCriteria, describeCriteria, criteriaToQuery, type Criteria } from "@/lib/job-criteria";
import { memberRoster, isMember } from "@/lib/membership";

/**
 * Designer job alerts.
 *
 * The employer flow (cron/match) ranks designers for a job. This runs the same
 * scorer the other way: for each opted-in designer, the roles posted since
 * their last email that clear the threshold, one per employer, best first.
 *
 * Rules, all deliberate:
 *  - Nothing sends with fewer than MIN_MATCHES. A thin alert teaches people to
 *    ignore the next one; a skipped week just widens the window for the next.
 *  - One role per employer. Adobe has 34 open; an alert that is a third Adobe
 *    reads like an ad.
 *  - Every role is logged per designer so it is never sent twice, whatever
 *    the cadence.
 *  - Every email carries a change-cadence link and a one-click stop.
 */

export const MIN_MATCHES = 3;
export const MAX_MATCHES = 10;
/** First alert after opt-in looks back this far. */
const FIRST_LOOKBACK_DAYS = 14;
const DAY = 864e5;

const CADENCE_DAYS: Record<AlertFrequency, number | null> = {
  NONE: null,
  DAILY: 1,
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 28,
};

export const CADENCE_LABEL: Record<AlertFrequency, string> = {
  NONE: "Not sending",
  DAILY: "Every weekday",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  MONTHLY: "Monthly",
};

export type AlertMatch = { job: Job; score: number };

type AlertDesigner = Pick<
  Designer,
  | "id" | "firstName" | "lastName" | "email" | "title" | "primaryRole" | "otherRoles"
  | "experienceLevel" | "typeOfRole" | "location" | "remotePreference" | "openToWork"
  | "companySize" | "photoUrl" | "editToken" | "alertFrequency" | "alertOptInAt"
  | "alertLastSentAt" | "wantsLeadership"
>;

const ALERT_DESIGNER_SELECT = {
  id: true, firstName: true, lastName: true, email: true, title: true, primaryRole: true,
  otherRoles: true, experienceLevel: true, typeOfRole: true, location: true,
  remotePreference: true, openToWork: true, companySize: true, photoUrl: true,
  editToken: true, alertFrequency: true, alertOptInAt: true, alertLastSentAt: true,
  wantsLeadership: true,
} as const;

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";
}

export function toDesignerForMatching(d: AlertDesigner): DesignerForMatching {
  return {
    id: d.id, firstName: d.firstName, lastName: d.lastName, title: d.title,
    primaryRole: d.primaryRole, otherRoles: d.otherRoles, experienceLevel: d.experienceLevel,
    typeOfRole: d.typeOfRole, location: d.location, remotePreference: d.remotePreference,
    openToWork: d.openToWork, companySize: d.companySize, photoUrl: d.photoUrl,
    wantsLeadership: d.wantsLeadership,
  };
}

function toJobForMatching(j: Job): JobForMatching {
  return {
    role: j.role, experienceLevel: j.experienceLevel, typeOfRole: j.typeOfRole,
    remote: j.remote, location: j.location, companySize: j.companySize, leadership: j.leadership,
  };
}

function companyKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Small deterministic hash so equal-scored roles order differently per designer. */
function tieBreak(designerId: string, jobId: string): number {
  let h = 0;
  const s = designerId + jobId;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Best roles for one designer from a candidate pool: threshold, one per
 * employer, capped. Ties break on a per-designer hash rather than recency:
 * with recency, everyone with a similar profile got the same three newest
 * roles and the emails read as a broadcast. Deterministic, so the same
 * designer sees the same list on re-render.
 */
export function pickMatches(designer: DesignerForMatching, jobs: Job[]): AlertMatch[] {
  const scored = jobs
    .map((job) => ({ job, score: scoreDesigner(designer, toJobForMatching(job)) }))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || tieBreak(designer.id, a.job.id) - tieBreak(designer.id, b.job.id));
  const seen = new Set<string>();
  const out: AlertMatch[] = [];
  for (const m of scored) {
    const k = companyKey(m.job.company);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

/** Due when never sent, or when the cadence interval has elapsed (half a day of slack for cron drift). */
export function isDue(d: Pick<Designer, "alertFrequency" | "alertLastSentAt">, now = new Date()): boolean {
  const days = CADENCE_DAYS[d.alertFrequency];
  if (!days) return false;
  if (!d.alertLastSentAt) return true;
  return now.getTime() - d.alertLastSentAt.getTime() >= (days - 0.5) * DAY;
}

// ---------------------------------------------------------------------------
// Email rendering. Inline styles only; the site's palette and voice.
// ---------------------------------------------------------------------------

const ORANGE = "#FF4725";
const INK = "#0A0A0A";
const PAPER = "#F5F2EC";
const MUTED = "#6B6862";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function button(href: string, label: string, primary = true): string {
  const bg = primary ? INK : "transparent";
  const fg = primary ? PAPER : INK;
  const border = primary ? "" : `border:1px solid ${INK};`;
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};${border}padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">${esc(label)}</a>`;
}

function roleRow(m: AlertMatch, base: string, designerId: string, src: string): string {
  const j = m.job;
  const where = j.remote ? (j.location ? `Remote · ${j.location}` : "Remote") : j.location;
  const pay = j.compensation ? ` · ${esc(j.compensation)}` : "";
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #E5E1D8;">
        <a href="${base}/jobs/${j.id}?utm_source=${src}&utm_medium=email&d=${designerId}" style="color:${INK};text-decoration:none;font-weight:700;font-size:16px;">${esc(j.title)}<span style="color:${ORANGE};">.</span></a>
        <div style="color:${MUTED};font-size:13px;margin-top:3px;">${esc(j.company)}${where ? ` · ${esc(where)}` : ""}${pay}</div>
      </td>
    </tr>`;
}

function shell(body: string): string {
  return `
  <div style="background:${PAPER};padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;padding:32px;border-radius:8px;">
      ${body}
    </div>
    <p style="max-width:560px;margin:16px auto 0;color:${MUTED};font-size:12px;line-height:1.5;">Design Better Careers · designbetter.careers</p>
  </div>`;
}

function footerLinks(token: string, base: string): string {
  return `
    <p style="color:${MUTED};font-size:12px;line-height:1.7;margin-top:28px;border-top:1px solid #E5E1D8;padding-top:16px;">
      <a href="${base}/alerts?token=${token}" style="color:${MUTED};">Change how often you hear from us</a> ·
      <a href="${base}/profile/edit?token=${token}" style="color:${MUTED};">Update your profile</a> ·
      <a href="${base}/alerts?token=${token}&stop=1" style="color:${MUTED};">Stop these emails</a>
    </p>`;
}

export function alertEmail(d: AlertDesigner, matches: AlertMatch[]): { subject: string; html: string } {
  const base = appUrl();
  const n = matches.length;
  const subject = `${n} design role${n === 1 ? "" : "s"} that match your profile`;
  const html = shell(`
    <h1 style="font-size:26px;line-height:1.15;margin:0 0 12px;">New roles for you<span style="color:${ORANGE};">.</span></h1>
    <p style="font-size:16px;line-height:1.5;margin:0 0 20px;">Hi ${esc(d.firstName)}, ${n} role${n === 1 ? "" : "s"} posted since your last email match what you told us: ${esc(d.primaryRole)}, ${esc(d.experienceLevel.replace(/\s*\(.*\)/, "").toLowerCase())}, ${esc(d.location)}${d.wantsLeadership ? ", leadership" : ""}.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;">${matches.map((m) => roleRow(m, base, d.id, "job_alert")).join("")}</table>
    <p style="margin:24px 0 0;">${button(`${base}/jobs?utm_source=job_alert&utm_medium=email&d=${d.id}`, "See every open role")}</p>
    ${footerLinks(d.editToken, base)}
  `);
  return { subject, html };
}

/**
 * The one-off invitation: "still looking? here are roles that match, choose a
 * cadence." Sent to the existing directory, hidden profiles included, because
 * the check-in email that asked for a confirmation and offered nothing back
 * is what left 214 profiles hidden.
 */
export function inviteEmail(d: AlertDesigner, samples: AlertMatch[], totalOnBoard: number): { subject: string; html: string } {
  const base = appUrl();
  const subject = samples.length
    ? `${samples.length} design roles matched to your profile`
    : "Design roles matched to your profile, on your schedule";
  const alertsUrl = `${base}/alerts?token=${d.editToken}`;
  const rolesBlock = samples.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;">${samples.map((m) => roleRow(m, base, d.id, "job_alert_invite")).join("")}</table>`
    : `<p style="font-size:16px;line-height:1.5;margin:0;">Nothing on the board matched your profile this week; the board carries ${totalOnBoard} open design roles and refreshes daily.</p>`;
  const html = shell(`
    <a href="${base}" style="display:inline-block;margin-bottom:24px;"><img src="${base}/DesignBetterCareers.png" width="160" alt="Design Better Careers" style="display:block;height:auto;border:0;"></a>
    <h1 style="font-size:26px;line-height:1.15;margin:0 0 20px;">We found a few job openings you might be interested in<span style="color:${ORANGE};">.</span></h1>
    ${rolesBlock}
    <p style="margin:16px 0 0;"><a href="${base}/jobs?utm_source=job_alert_invite&utm_medium=email&d=${d.id}" style="color:${INK};font-weight:600;font-size:15px;text-decoration:none;">View all ${totalOnBoard} job openings &rarr;</a></p>
    <p style="font-size:16px;line-height:1.5;margin:28px 0 16px;">Choose the kinds of roles you want to hear about, and how often: weekly, every two weeks, or monthly.</p>
    <p style="margin:0 0 20px;">${button(alertsUrl, "Set my job preferences")}</p>
    <p style="font-size:14px;line-height:1.5;margin:0;"><a href="${alertsUrl}&stop=1" style="color:${MUTED};">I no longer want job recommendations.</a></p>
    <p style="font-size:16px;line-height:1.5;margin:28px 0 0;">— Aarron &amp; Eli<br><a href="https://designbetterpodcast.com/" style="color:${MUTED};font-size:14px;text-decoration:none;">Design Better</a></p>
    ${footerLinks(d.editToken, base)}
  `);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

export interface SendAlertsResult {
  considered: number;
  due: number;
  sent: number;
  skippedThin: number;
  errors: string[];
  samples: Array<{ designer: string; role: string; matches: number; top: string[] }>;
}

export async function sendJobAlerts(opts: { dryRun?: boolean; limit?: number } = {}): Promise<SendAlertsResult> {
  const now = new Date();
  const dryRun = Boolean(opts.dryRun);
  const result: SendAlertsResult = { considered: 0, due: 0, sent: 0, skippedThin: 0, errors: [], samples: [] };

  const designers = await db.designer.findMany({
    where: { alertFrequency: { not: "NONE" }, openToWork: { not: "NOT_LOOKING" } },
    select: ALERT_DESIGNER_SELECT,
    orderBy: { alertLastSentAt: { sort: "asc", nulls: "first" } },
  });
  result.considered = designers.length;
  const due = designers.filter((d) => isDue(d, now)).slice(0, opts.limit ?? designers.length);
  result.due = due.length;
  if (!due.length) return result;

  // Widest window any designer could need; per-designer narrowing below.
  const oldest = new Date(now.getTime() - Math.max(FIRST_LOOKBACK_DAYS, 28) * DAY);
  const pool = await db.job.findMany({ where: { active: true, createdAt: { gte: oldest } } });

  const resend = dryRun ? null : getResend();
  const from = getFrom();

  for (const d of due) {
    // First alert looks back a fixed window; measuring from the opt-in moment
    // meant a designer who signed up on Monday had zero candidates on Tuesday
    // while the opt-in page had just told them ten roles matched.
    const since = d.alertLastSentAt ?? new Date(now.getTime() - FIRST_LOOKBACK_DAYS * DAY);
    const sentBefore = new Set(
      (await db.jobAlertLog.findMany({ where: { designerId: d.id }, select: { jobId: true } })).map((l) => l.jobId),
    );
    const candidates = pool.filter((j) => j.createdAt >= since && !sentBefore.has(j.id));
    const matches = pickMatches(toDesignerForMatching(d), candidates);

    if (result.samples.length < 5) {
      result.samples.push({
        designer: d.firstName, role: d.primaryRole, matches: matches.length,
        top: matches.slice(0, 3).map((m) => `${m.score} ${m.job.title} @ ${m.job.company}`),
      });
    }
    if (matches.length < MIN_MATCHES) {
      // Leave alertLastSentAt alone so the window keeps widening until it's worth sending.
      result.skippedThin++;
      continue;
    }
    if (dryRun) { result.sent++; continue; }

    const { subject, html } = alertEmail(d, matches);
    try {
      await resend!.emails.send({
        from, to: d.email, subject, html,
        headers: { "List-Unsubscribe": `<${appUrl()}/alerts?token=${d.editToken}&stop=1>` },
      });
      await db.jobAlertLog.createMany({
        data: matches.map((m) => ({ designerId: d.id, jobId: m.job.id })),
        skipDuplicates: true,
      });
      await db.designer.update({ where: { id: d.id }, data: { alertLastSentAt: now } });
      result.sent++;
    } catch (e) {
      result.errors.push(`${d.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

export interface CampaignResult {
  cohort: string;
  eligible: number;
  processed: number;
  sent: number;
  withSamples: number;
  nextOffset: number;
  done: boolean;
  errors: string[];
  preview: Array<{ designer: string; email: string; hidden: boolean; subject: string; samples: string[] }>;
}

/**
 * Sends the invitation in batches. Never sends twice (alertInviteSentAt), never
 * to designers who already opted in, never to anyone marked not looking.
 */
export async function sendAlertsInvite(opts: {
  dryRun?: boolean; offset?: number; limit?: number; cohort?: "all" | "visible" | "hidden"; emails?: string[];
} = {}): Promise<CampaignResult> {
  const dryRun = Boolean(opts.dryRun);
  const cohort = opts.cohort ?? "all";
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 25;

  const eligibleRows = await db.designer.findMany({
    where: {
      openToWork: { not: "NOT_LOOKING" },
      alertFrequency: "NONE",
      alertInviteSentAt: null,
      ...(cohort === "visible" ? { hidden: false } : cohort === "hidden" ? { hidden: true } : {}),
      ...(opts.emails?.length ? { email: { in: opts.emails } } : {}),
    },
    select: { ...ALERT_DESIGNER_SELECT, hidden: true },
    orderBy: { id: "asc" },
  });
  const batch = eligibleRows.slice(offset, offset + limit);
  const result: CampaignResult = {
    cohort, eligible: eligibleRows.length, processed: batch.length, sent: 0, withSamples: 0,
    nextOffset: offset + batch.length, done: offset + batch.length >= eligibleRows.length,
    errors: [], preview: [],
  };
  if (!batch.length) return result;

  const [pool, totalOnBoard] = await Promise.all([
    db.job.findMany({ where: { active: true, createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
    db.job.count({ where: { active: true } }),
  ]);
  const resend = dryRun ? null : getResend();
  const from = getFrom();

  for (const d of batch) {
    const samples = pickMatches(toDesignerForMatching(d), pool).slice(0, 3);
    if (samples.length) result.withSamples++;
    const { subject, html } = inviteEmail(d, samples, totalOnBoard);
    if (result.preview.length < 5) {
      result.preview.push({
        designer: d.firstName, email: d.email, hidden: d.hidden, subject,
        samples: samples.map((m) => `${m.score} ${m.job.title} @ ${m.job.company}`),
      });
    }
    if (dryRun) { result.sent++; continue; }
    try {
      await resend!.emails.send({
        from, to: d.email, subject, html,
        headers: { "List-Unsubscribe": `<${appUrl()}/alerts?token=${d.editToken}&stop=1>` },
      });
      await db.designer.update({ where: { id: d.id }, data: { alertInviteSentAt: new Date() } });
      result.sent++;
    } catch (e) {
      result.errors.push(`${d.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Custom saved-search alerts (paid tier). See docs/custom-alerts-contract.md.
// ---------------------------------------------------------------------------

export function isAlertDue(a: Pick<JobAlert, "frequency" | "lastSentAt" | "pausedAt">, now = new Date()): boolean {
  if (a.pausedAt) return false;
  const days = CADENCE_DAYS[a.frequency];
  if (!days) return false;
  if (!a.lastSentAt) return true;
  return now.getTime() - a.lastSentAt.getTime() >= (days - 0.5) * DAY;
}

function customAlertEmail(
  d: AlertDesigner,
  sends: Array<{ alert: JobAlert; criteria: Criteria; matches: AlertMatch[] }>,
): { subject: string; html: string } {
  const base = appUrl();
  const total = sends.reduce((n, s) => n + s.matches.length, 0);
  const subject = sends.length === 1
    ? `${total} new role${total === 1 ? "" : "s"}: ${sends[0].alert.name}`
    : `${total} new roles across ${sends.length} of your saved searches`;
  const sections = sends.map(({ alert, criteria, matches }) => `
    <h2 style="font-size:16px;margin:26px 0 4px;">${esc(alert.name)}<span style="color:${ORANGE};">.</span></h2>
    <p style="color:${MUTED};font-size:12px;margin:0 0 6px;">${esc(describeCriteria(criteria))} · <a href="${base}/jobs?${criteriaToQuery(criteria)}&utm_source=custom_alert&utm_medium=email&d=${d.id}" style="color:${MUTED};">see all on the board</a></p>
    <table role="presentation" style="width:100%;border-collapse:collapse;">${matches.map((m) => roleRow(m, base, d.id, "custom_alert")).join("")}</table>`).join("");
  const html = shell(`
    <h1 style="font-size:26px;line-height:1.15;margin:0 0 12px;">New roles for you<span style="color:${ORANGE};">.</span></h1>
    <p style="font-size:16px;line-height:1.5;margin:0;">Hi ${esc(d.firstName)}, here is what matched your saved search${sends.length === 1 ? "" : "es"} since the last email.</p>
    ${sections}
    <p style="color:${MUTED};font-size:12px;line-height:1.7;margin-top:28px;border-top:1px solid #E5E1D8;padding-top:16px;">
      <a href="${base}/alerts?token=${d.editToken}" style="color:${MUTED};">Edit your saved searches or cadence</a> ·
      <a href="${base}/alerts?token=${d.editToken}&stop=1" style="color:${MUTED};">Stop these emails</a>
    </p>
  `);
  return { subject, html };
}

export interface SendCustomAlertsResult {
  alerts: number;
  due: number;
  pausedNotMember: number;
  unpaused: number;
  sent: number;
  skippedThin: number;
  errors: string[];
  samples: Array<{ designer: string; alert: string; matches: number }>;
}

/**
 * Custom alerts: hard-filter by criteria, then the same scorer, dedupe and
 * floor as profile alerts. Membership is re-checked every run: a lapsed member
 * has their custom alerts paused (never deleted); a returning member's are
 * unpaused and resume on the next due date. One email per designer per run,
 * however many of their searches fired.
 */
export async function sendCustomAlerts(opts: { dryRun?: boolean; limit?: number } = {}): Promise<SendCustomAlertsResult> {
  const now = new Date();
  const dryRun = Boolean(opts.dryRun);
  const result: SendCustomAlertsResult = { alerts: 0, due: 0, pausedNotMember: 0, unpaused: 0, sent: 0, skippedThin: 0, errors: [], samples: [] };

  const alerts = await db.jobAlert.findMany({
    where: { OR: [{ pausedAt: null }, { pausedReason: "not_member" }] },
    include: { designer: { select: { ...ALERT_DESIGNER_SELECT, memberEmail: true, memberStatus: true, memberCheckedAt: true } } },
    orderBy: { lastSentAt: { sort: "asc", nulls: "first" } },
  });
  result.alerts = alerts.length;
  if (!alerts.length) return result;

  // Membership gate, one roster fetch for the whole run.
  const roster = await memberRoster();
  const byDesigner = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const member = isMember(a.designer, roster, now);
    if (!member && !a.pausedAt) {
      result.pausedNotMember++;
      if (!dryRun) await db.jobAlert.update({ where: { id: a.id }, data: { pausedAt: now, pausedReason: "not_member" } });
      continue;
    }
    if (member && a.pausedAt && a.pausedReason === "not_member") {
      result.unpaused++;
      if (!dryRun) await db.jobAlert.update({ where: { id: a.id }, data: { pausedAt: null, pausedReason: null } });
      a.pausedAt = null;
    }
    if (!member || a.designer.openToWork === "NOT_LOOKING" || !isAlertDue(a, now)) continue;
    const list = byDesigner.get(a.designerId) ?? [];
    list.push(a);
    byDesigner.set(a.designerId, list);
  }
  const designers = [...byDesigner.entries()].slice(0, opts.limit ?? byDesigner.size);
  result.due = designers.reduce((n, [, l]) => n + l.length, 0);
  if (!designers.length) return result;

  const oldest = new Date(now.getTime() - 28 * DAY);
  const pool = await db.job.findMany({ where: { active: true, createdAt: { gte: oldest } } });
  const resend = dryRun ? null : getResend();
  const from = getFrom();

  for (const [designerId, list] of designers) {
    const d = list[0].designer;
    const sentBefore = new Set(
      (await db.jobAlertLog.findMany({ where: { designerId }, select: { jobId: true } })).map((l) => l.jobId),
    );
    const sends: Array<{ alert: JobAlert; criteria: Criteria; matches: AlertMatch[] }> = [];
    const usedJobIds = new Set<string>();
    for (const a of list) {
      const criteria = parseCriteria(a.criteria as Record<string, unknown>);
      const since = a.lastSentAt ?? new Date(now.getTime() - FIRST_LOOKBACK_DAYS * DAY);
      const candidates = pool.filter((j) => j.createdAt >= since && !sentBefore.has(j.id) && !usedJobIds.has(j.id) && matchesCriteria(j, criteria));
      const matches = pickMatches(toDesignerForMatching(d), candidates);
      result.samples.length < 5 && result.samples.push({ designer: d.firstName, alert: a.name, matches: matches.length });
      if (matches.length < MIN_MATCHES) { result.skippedThin++; continue; }
      for (const m of matches) usedJobIds.add(m.job.id);
      sends.push({ alert: a, criteria, matches });
    }
    if (!sends.length) continue;
    if (dryRun) { result.sent++; continue; }

    const { subject, html } = customAlertEmail(d, sends);
    try {
      await resend!.emails.send({
        from, to: d.email, subject, html,
        headers: { "List-Unsubscribe": `<${appUrl()}/alerts?token=${d.editToken}&stop=1>` },
      });
      await db.jobAlertLog.createMany({
        data: sends.flatMap((s) => s.matches.map((m) => ({ designerId, jobId: m.job.id }))),
        skipDuplicates: true,
      });
      await db.jobAlert.updateMany({ where: { id: { in: sends.map((s) => s.alert.id) } }, data: { lastSentAt: now } });
      result.sent++;
    } catch (e) {
      result.errors.push(`${d.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}
