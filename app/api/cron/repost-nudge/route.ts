import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { excludeOwnerPosters } from "@/lib/owner-emails";
import { EMAIL_LOGO } from "@/lib/email-logo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

// Send nudge 30–37 days after a paid job expires (= ~90–97 days after posting)
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
const DAYS_37 = 37 * 24 * 60 * 60 * 1000;
// Don't nudge jobs older than 6 months (pre-feature)
const DAYS_180 = 180 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - DAYS_37);
  const windowEnd = new Date(now.getTime() - DAYS_30);
  const tooOld = new Date(now.getTime() - DAYS_180);

  // Find paid jobs that expired within the nudge window and haven't been nudged yet
  const jobs = await db.job.findMany({
    where: {
      stripePaymentStatus: "paid",
      repostNudgeSentAt: null,
      active: false,
      // Our own seeded listings are marked "paid" and get deactivated when the
      // source posting closes, so without this we'd nudge ourselves to repost
      // every job the ingest has ever added.
      ...excludeOwnerPosters(),
      createdAt: { gte: tooOld },
      expiresAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    select: {
      id: true,
      title: true,
      company: true,
      posterFirstName: true,
      posterEmail: true,
      manageToken: true,
    },
  });

  let sent = 0;

  for (const job of jobs) {
    const postUrl = `${APP_URL}/post-a-job`;

    await getResend().emails.send({
      from: getFrom(),
      to: job.posterEmail,
      subject: `Did you fill the ${job.title} role?`,
      html: `
        ${EMAIL_LOGO}
        <p>Hi ${job.posterFirstName},</p>
        <p>Your <strong>${job.title}</strong> listing at ${job.company} on Design Better Careers wrapped up a few weeks ago.</p>
        <p>Did you find your person? 🎉</p>
        <p>If you're still hiring — or have a new role to fill — you can post again in a few clicks. Use code <strong>COMEBACK</strong> for 20% off:</p>
        <p>
          <a href="${postUrl}" style="display:inline-block;background:#C1121F;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Post a new job →</a>
        </p>
        <p style="color:#888;font-size:14px;">Our talent directory keeps growing — more senior designers join every week. You'll reach a larger pool than last time.</p>
        <p>— Design Better Careers</p>
      `,
    });

    await db.job.update({
      where: { id: job.id },
      data: { repostNudgeSentAt: now },
    });

    sent++;
  }

  return NextResponse.json({ sent });
}
