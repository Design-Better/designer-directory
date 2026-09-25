"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { checkMember, normalizeEmail } from "@/lib/membership";
import { parseCriteria, describeCriteria, criteriaToQuery, isEmptyCriteria, MAX_SAVED_SEARCHES } from "@/lib/job-criteria";
import { logAlertEvent } from "@/lib/alert-events";
import { signInEmail } from "@/lib/job-alerts";
import { PRIMARY_ROLES, EXPERIENCE_LEVELS } from "@/lib/utils";
import type { AlertFrequency } from "@prisma/client";

const PAID_FREQUENCIES: AlertFrequency[] = ["DAILY", "WEEKLY", "BIWEEKLY"];

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";
}

// Per-instance, resets on cold start: enough to blunt casual enumeration of
// the sign-in form, not a real defence (same limitation as the profile flow).
const attempts = new Map<string, { n: number; at: number }>();
function limited(key: string, max = 10): boolean {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || now - cur.at > 60 * 60 * 1000) { attempts.set(key, { n: 1, at: now }); return false; }
  cur.n++;
  return cur.n > max;
}

/**
 * Step 1: an unidentified visitor gives an email. We send a sign-in link that
 * carries the criteria; only a clicked link creates or attaches anything.
 * The response never says whether the address exists.
 */
export async function requestAlertLink(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const firstName = String(formData.get("firstName") ?? "").trim().slice(0, 60);
  const qs = String(formData.get("criteria") ?? "");
  const criteria = parseCriteria(new URLSearchParams(qs));

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/alerts/new?${qs}&error=email`);
  if (limited(email)) redirect(`/alerts/new?${qs}&sent=1`);

  let designer = await db.designer.findUnique({ where: { email }, select: { id: true, editToken: true, firstName: true } });
  if (!designer) {
    // A private row that exists only to hold alerts. The profile can be
    // published later; nothing here is visible to employers.
    designer = await db.designer.create({
      data: {
        email,
        firstName: firstName || "there",
        lastName: "",
        primaryRole: criteria.role?.[0] && (PRIMARY_ROLES as readonly string[]).includes(criteria.role[0]) ? criteria.role[0] : "Product Design",
        otherRoles: [],
        experienceLevel: criteria.level?.[0] && (EXPERIENCE_LEVELS as readonly string[]).includes(criteria.level[0]) ? criteria.level[0] : "Mid Career (3-8 years)",
        location: criteria.location ?? (criteria.remote ? "Remote" : "Not specified"),
        typeOfRole: criteria.type ?? [],
        remotePreference: criteria.remote ? "Remote only" : null,
        publicProfile: false,
        hidden: true,
      },
      select: { id: true, editToken: true, firstName: true },
    });
  }

  const link = `${appUrl()}/alerts/new?token=${designer.editToken}${qs ? `&${qs}` : ""}`;
  const label = describeCriteria(criteria);
  const { subject, html } = signInEmail(designer.firstName, label, link);
  await getResend().emails.send({ from: getFrom(), to: email, subject, html });
  logAlertEvent({ kind: "custom_request", designerId: designer.id });
  redirect(`/alerts/new?${qs}&sent=1`);
}

/**
 * Step 2, on a mismatch: the designer names the address they subscribe with.
 * Checked live; stored only when it is entitled.
 */
export async function addMemberEmail(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const qs = String(formData.get("criteria") ?? "");
  const memberEmail = normalizeEmail(String(formData.get("memberEmail") ?? ""));
  const designer = token ? await db.designer.findUnique({ where: { editToken: token }, select: { id: true } }) : null;
  if (!designer) redirect("/alerts?error=notfound");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(memberEmail) || limited(`m:${designer.id}`, 6)) {
    redirect(`/alerts/new?token=${token}&${qs}&member=invalid`);
  }
  const check = await checkMember(memberEmail);
  if (check.entitled) {
    await db.designer.update({
      where: { id: designer.id },
      data: { memberEmail, memberStatus: check.status, memberCheckedAt: new Date() },
    });
    redirect(`/alerts/new?token=${token}&${qs}`);
  }
  redirect(`/alerts/new?token=${token}&${qs}&member=${check.live ? "notfound" : "unavailable"}`);
}

/** Step 3: save the search. Entitlement is re-checked server-side here, not trusted from the page. */
export async function saveJobAlert(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const designer = token
    ? await db.designer.findUnique({ where: { editToken: token }, select: { id: true, email: true, memberEmail: true, memberStatus: true, memberCheckedAt: true, _count: { select: { jobAlerts: true } } } })
    : null;
  if (!designer) redirect("/alerts?error=notfound");

  const { isMember, memberRoster } = await import("@/lib/membership");
  const roster = await memberRoster();
  let entitled = isMember(designer, roster);
  if (!entitled) {
    // Last resort: a live check on both addresses, recorded if it passes.
    for (const e of [designer.email, designer.memberEmail]) {
      if (!e) continue;
      const c = await checkMember(e);
      if (c.entitled) {
        await db.designer.update({ where: { id: designer.id }, data: { memberStatus: c.status, memberCheckedAt: new Date() } });
        entitled = true;
        break;
      }
    }
  }
  if (!entitled) redirect(`/alerts/new?token=${token}&member=notfound`);
  if (designer._count.jobAlerts >= MAX_SAVED_SEARCHES) redirect(`/alerts?token=${token}&limit=1`);

  const criteria = parseCriteria(Object.fromEntries(
    ["q", "role", "level", "type", "company", "location", "remote", "leadership", "salary", "salaryMin"].map((k) => {
      const all = formData.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
      return [k, all.length > 1 ? all.join(",") : all[0]];
    }),
  ));
  if (isEmptyCriteria(criteria)) redirect(`/alerts/new?token=${token}&error=empty`);

  const frequencyRaw = String(formData.get("frequency") ?? "");
  const frequency = PAID_FREQUENCIES.includes(frequencyRaw as AlertFrequency) ? (frequencyRaw as AlertFrequency) : "WEEKLY";
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || describeCriteria(criteria);

  const alert = await db.jobAlert.create({
    data: { designerId: designer.id, name, criteria: criteria as object, frequency },
    select: { id: true },
  });
  logAlertEvent({ kind: "custom_saved", designerId: designer.id, detail: `${frequency}:${criteriaToQuery(criteria).slice(0, 200)}` });
  redirect(`/alerts?token=${token}&saved=${alert.id}`);
}

export async function setAlertPaused(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const id = String(formData.get("id") ?? "");
  const paused = formData.get("paused") === "1";
  const designer = token ? await db.designer.findUnique({ where: { editToken: token }, select: { id: true } }) : null;
  if (!designer) redirect("/alerts?error=notfound");
  await db.jobAlert.updateMany({
    where: { id, designerId: designer.id },
    data: paused ? { pausedAt: new Date(), pausedReason: "user" } : { pausedAt: null, pausedReason: null },
  });
  redirect(`/alerts?token=${token}`);
}

export async function deleteJobAlert(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const id = String(formData.get("id") ?? "");
  const designer = token ? await db.designer.findUnique({ where: { editToken: token }, select: { id: true } }) : null;
  if (!designer) redirect("/alerts?error=notfound");
  await db.jobAlert.deleteMany({ where: { id, designerId: designer.id } });
  redirect(`/alerts?token=${token}`);
}
