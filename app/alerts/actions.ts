"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { logAlertEvent } from "@/lib/alert-events";
import { getResend, getFrom } from "@/lib/resend";
import { signInEmail } from "@/lib/job-alerts";
import { normalizeEmail } from "@/lib/membership";
import { PRIMARY_ROLES, EXPERIENCE_LEVELS, ROLE_TYPES, REMOTE_PREFERENCES } from "@/lib/utils";
import type { AlertFrequency, WorkStatus } from "@prisma/client";

const FREQUENCIES: AlertFrequency[] = ["NONE", "WEEKLY", "BIWEEKLY", "MONTHLY"];
const STATUSES: WorkStatus[] = ["OPEN", "OPEN_SOON", "NOT_LOOKING"];

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * One submit does three jobs: records whether they're still looking, sets the
 * alert cadence, and refreshes the fields matching runs on. Any answer also
 * counts as confirming the profile, which is the point — this replaces the
 * check-in email that asked for a confirmation and offered nothing back.
 */
export async function saveAlertPreferences(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const designer = token
    ? await db.designer.findUnique({
        where: { editToken: token },
        select: { id: true, alertOptInAt: true, primaryRole: true, experienceLevel: true, remotePreference: true },
      })
    : null;
  if (!designer) redirect("/alerts?error=notfound");

  const now = new Date();
  const status = pick(formData.get("status"), STATUSES) ?? "OPEN";

  if (status === "NOT_LOOKING") {
    await db.designer.update({
      where: { id: designer.id },
      data: {
        openToWork: "NOT_LOOKING",
        alertFrequency: "NONE",
        hidden: true,
        lastConfirmedAt: now,
        confirmSentAt: null,
      },
    });
    logAlertEvent({ kind: "prefs_saved", designerId: designer.id, detail: "NOT_LOOKING" });
    redirect(`/alerts?token=${encodeURIComponent(token)}&saved=1`);
  }

  const frequency = pick(formData.get("frequency"), FREQUENCIES) ?? "NONE";
  // Accept list members or the designer's existing value (legacy options the
  // form shows as "(current)"); anything else is ignored and the field kept.
  const primaryRole = pick(formData.get("primaryRole"), [...PRIMARY_ROLES, designer.primaryRole]);
  const experienceLevel = pick(formData.get("experienceLevel"), [...EXPERIENCE_LEVELS, designer.experienceLevel]);
  const remotePreference = pick(formData.get("remotePreference"), [...REMOTE_PREFERENCES, ...(designer.remotePreference ? [designer.remotePreference] : [])]);
  const location = String(formData.get("location") ?? "").trim().slice(0, 120);
  const typeOfRole = formData.getAll("typeOfRole").filter((v): v is string => typeof v === "string" && (ROLE_TYPES as readonly string[]).includes(v));

  await db.designer.update({
    where: { id: designer.id },
    data: {
      openToWork: status,
      hidden: false,
      publicProfile: true,
      lastConfirmedAt: now,
      confirmSentAt: null,
      alertFrequency: frequency,
      alertOptInAt: frequency === "NONE" ? designer.alertOptInAt : (designer.alertOptInAt ?? now),
      wantsLeadership: formData.get("wantsLeadership") === "on",
      ...(primaryRole ? { primaryRole } : {}),
      ...(experienceLevel ? { experienceLevel } : {}),
      ...(remotePreference ? { remotePreference } : {}),
      ...(location ? { location } : {}),
      ...(typeOfRole.length ? { typeOfRole } : {}),
    },
  });
  logAlertEvent({ kind: "prefs_saved", designerId: designer.id, detail: `${status}/${frequency}` });
  redirect(`/alerts?token=${encodeURIComponent(token)}&saved=1`);
}

// Per-instance, resets on cold start: blunts casual abuse of the link form,
// same limitation as the saved-search sign-in.
const linkAttempts = new Map<string, { n: number; at: number }>();
function limited(key: string, max = 5): boolean {
  const now = Date.now();
  const cur = linkAttempts.get(key);
  if (!cur || now - cur.at > 60 * 60 * 1000) { linkAttempts.set(key, { n: 1, at: now }); return false; }
  cur.n++;
  return cur.n > max;
}

/**
 * The front door for free profile alerts: a designer without their link gives
 * the email on their profile and we send it. The page shows the same answer
 * whether or not the address has a profile, so it can't be used to learn who
 * is in the directory. Unknown addresses get nothing and nothing is created.
 * The email is the approved sign-in template (Email 3), unchanged.
 */
export async function requestAlertsLink(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/alerts?error=email");
  if (limited(email)) redirect("/alerts?sent=1");
  const designer = await db.designer.findUnique({ where: { email }, select: { id: true, firstName: true, editToken: true } });
  if (designer) {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";
    const { subject, html } = signInEmail(designer.firstName, "", `${base}/alerts?token=${designer.editToken}`);
    await getResend().emails.send({ from: getFrom(), to: email, subject, html });
    logAlertEvent({ kind: "alerts_link_request", designerId: designer.id });
  }
  redirect("/alerts?sent=1");
}
