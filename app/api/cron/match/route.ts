import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { rankDesigners, type DesignerForMatching } from "@/lib/matching";
import { excludeOwnerPosters } from "@/lib/owner-emails";
import { EMAIL_LOGO } from "@/lib/email-logo";

export async function GET(req: NextRequest) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  // Fetch all active jobs that have opted into matching.
  // Jobs we posted ourselves are excluded outright: the board is largely seeded
  // by our own ingest, so matching on them just mails us about our own
  // listings. Enforced here rather than relying on matchFrequency alone, so no
  // future code path that sets a frequency can start it up again.
  const jobs = await db.job.findMany({
    where: {
      active: true,
      matchFrequency: { not: null },
      ...excludeOwnerPosters(),
    },
  });

  const results = { processed: 0, sent: 0, skipped: 0 };

  for (const job of jobs) {
    results.processed++;

    // Determine if this job is due for a digest
    const isDue = (() => {
      if (!job.matchFrequency) return false;
      if (job.matchFrequency === "once") return job.lastMatchSentAt === null;
      const daysSinceLast = job.lastMatchSentAt
        ? (now.getTime() - job.lastMatchSentAt.getTime()) / (1000 * 60 * 60 * 24)
        : Infinity;
      if (job.matchFrequency === "weekly") return daysSinceLast >= 7;
      if (job.matchFrequency === "biweekly") return daysSinceLast >= 14;
      return false;
    })();

    if (!isDue) {
      results.skipped++;
      continue;
    }

    // Find designers already sent for this job
    const previousLogs = await db.jobMatchLog.findMany({
      where: { jobId: job.id },
      select: { designerId: true },
    });
    const alreadySentIds = new Set(previousLogs.map((l) => l.designerId));

    // Fetch all eligible designers
    const designers = await db.designer.findMany({
      where: {
        publicProfile: true,
        hidden: false,
        openToWork: { not: "NOT_LOOKING" },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        primaryRole: true,
        otherRoles: true,
        experienceLevel: true,
        typeOfRole: true,
        location: true,
        remotePreference: true,
        openToWork: true,
        companySize: true,
        photoUrl: true,
      },
    });

    const ranked = rankDesigners(designers as DesignerForMatching[], job, alreadySentIds);
    const topMatches = ranked.slice(0, 10);

    if (topMatches.length === 0) {
      results.skipped++;
      // Still mark as sent so "once" jobs don't retry endlessly when pool is thin
      if (job.matchFrequency === "once") {
        await db.job.update({ where: { id: job.id }, data: { lastMatchSentAt: now } });
      }
      continue;
    }

    // Build match digest email
    const matchRows = topMatches
      .map(({ designer, score, label }) => {
        const badgeColor = score >= 80 ? "#16a34a" : "#2563eb";
        const availLabel =
          designer.openToWork === "OPEN" ? "Actively looking" : "Open in 3 months";
        return `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
              <strong style="font-size:15px;color:#111;">${designer.firstName} ${designer.lastName}</strong>
              <span style="font-size:12px;font-weight:600;color:${badgeColor};background:${score >= 80 ? "#f0fdf4" : "#eff6ff"};padding:2px 8px;border-radius:99px;">${label}</span>
            </div>
            <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">${designer.title || designer.primaryRole} · ${designer.location}</p>
            <p style="margin:0 0 10px;font-size:12px;color:#9ca3af;">${availLabel}</p>
            <a href="${appUrl}/talent/${designer.id}" style="font-size:13px;font-weight:600;color:#111;text-decoration:none;border:1px solid #d1d5db;border-radius:6px;padding:6px 12px;display:inline-block;">View profile →</a>
          </div>`;
      })
      .join("");

    const frequencyNote =
      job.matchFrequency === "once"
        ? ""
        : `<p style="font-size:13px;color:#6b7280;margin-top:8px;">You'll receive ${job.matchFrequency === "weekly" ? "weekly" : "bi-weekly"} updates with new matches for this role.</p>`;

    const manageUrl = `${appUrl}/api/jobs/close?token=${job.manageToken}`;

    const emailHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#111;">
        ${EMAIL_LOGO}
        <h2 style="font-size:20px;font-weight:700;margin-bottom:4px;">Your matched designers</h2>
        <p style="color:#6b7280;margin-bottom:4px;font-size:14px;">${job.title} at ${job.company}</p>
        <p style="color:#6b7280;margin-bottom:24px;font-size:14px;">We found <strong style="color:#111;">${topMatches.length} designer${topMatches.length !== 1 ? "s" : ""}</strong> who match your role. Here are your top picks:</p>
        ${matchRows}
        ${frequencyNote}
        <p style="margin-top:16px;font-size:14px;">
          <a href="${appUrl}/talent" style="color:#111;font-weight:600;">Browse the full talent directory →</a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0" />
        <p style="font-size:12px;color:#9ca3af;">
          Role filled? <a href="${manageUrl}" style="color:#9ca3af;">Remove this listing →</a>
        </p>
      </div>`;

    try {
      await getResend().emails.send({
        from: getFrom(),
        to: job.posterEmail,
        subject: `${topMatches.length} designer match${topMatches.length !== 1 ? "es" : ""} for "${job.title}" at ${job.company}`,
        html: emailHtml,
      });

      // Log sent designers and update job
      await db.$transaction([
        db.jobMatchLog.createMany({
          data: topMatches.map(({ designer, score }) => ({
            jobId: job.id,
            designerId: designer.id,
            score,
          })),
          skipDuplicates: true,
        }),
        db.job.update({
          where: { id: job.id },
          data: { lastMatchSentAt: now },
        }),
      ]);

      results.sent++;
    } catch (err) {
      console.error(`Match email failed for job ${job.id}:`, err);
    }
  }

  return NextResponse.json(results);
}
