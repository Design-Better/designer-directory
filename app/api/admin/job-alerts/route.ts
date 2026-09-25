import { NextRequest, NextResponse } from "next/server";
import { sendJobAlerts, sendAlertsInvite, sendCustomAlerts, sendEmailPreviews } from "@/lib/job-alerts";
import { buildAlertReport, sendAlertReport } from "@/lib/alert-report";
import { db } from "@/lib/db";

export const maxDuration = 300;

/**
 * POST /api/admin/job-alerts   Auth: x-admin-secret
 *
 * Body: { mode: "alerts" | "invite", dryRun?, limit?, offset?, cohort?, emails? }
 *
 *   alerts — run the weekly alert pass by hand (dryRun previews who'd get what)
 *   invite — the one-off "still looking? choose a cadence" campaign, batched
 *            by offset/limit; `emails` restricts to specific addresses for a
 *            test send; cohort "visible" | "hidden" | "all"
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-secret") !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as {
    mode?: string; dryRun?: boolean; limit?: number; offset?: number;
    cohort?: "all" | "visible" | "hidden"; emails?: string[]; email?: boolean; to?: string; grantEmail?: string; revoke?: boolean;
  };
  const dryRun = Boolean(body.dryRun);
  const build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

  if (body.mode === "alerts") {
    return NextResponse.json({ ok: true, mode: "alerts", dryRun, build, ...(await sendJobAlerts({ dryRun, limit: body.limit })) });
  }
  // Support tool: grant (or revoke) saved searches by hand, for testing and for
  // the rare person db-community cannot see. "granted" is never overwritten by
  // a community answer and lasts 30 days from the grant.
  if (body.mode === "grant" && body.grantEmail) {
    const r = await db.designer.updateMany({
      where: { email: body.grantEmail.trim().toLowerCase() },
      data: body.revoke ? { memberStatus: "none", memberCheckedAt: new Date() } : { memberStatus: "granted", memberCheckedAt: new Date() },
    });
    return NextResponse.json({ ok: true, mode: "grant", build, updated: r.count, revoked: Boolean(body.revoke) });
  }
  // One test of each subscriber email, to an owner address only. Never to a list.
  if (body.mode === "preview") {
    return NextResponse.json({ ok: true, mode: "preview", build, ...(await sendEmailPreviews(typeof body.to === "string" ? body.to : undefined)) });
  }
  if (body.mode === "custom") {
    return NextResponse.json({ ok: true, mode: "custom", dryRun, build, ...(await sendCustomAlerts({ dryRun, limit: body.limit })) });
  }
  if (body.mode === "invite") {
    return NextResponse.json({
      ok: true, mode: "invite", dryRun, build,
      ...(await sendAlertsInvite({ dryRun, offset: body.offset, limit: body.limit, cohort: body.cohort, emails: body.emails })),
    });
  }
  // Funnel report (same one the Friday cron emails). email:true sends it now.
  if (body.mode === "report") {
    if (body.email) {
      const { to, subject, report } = await sendAlertReport(typeof body.to === "string" ? body.to : undefined);
      return NextResponse.json({ ok: true, mode: "report", build, emailed: to, subject, ...report });
    }
    return NextResponse.json({ ok: true, mode: "report", build, ...(await buildAlertReport()) });
  }
  return NextResponse.json({ error: `Unknown mode "${body.mode}"` }, { status: 400 });
}
