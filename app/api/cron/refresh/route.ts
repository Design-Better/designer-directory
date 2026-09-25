import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { EMAIL_LOGO } from "@/lib/email-logo";

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);

  const designers = await db.designer.findMany({
    where: {
      publicProfile: true,
      hidden: false,
      OR: [
        { lastConfirmedAt: null },
        { lastConfirmedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, firstName: true, email: true, editToken: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const resend = getResend();
  const from = getFrom();
  let sent = 0;

  for (const designer of designers) {
    const confirmUrl = `${appUrl}/api/confirm?token=${designer.editToken}`;
    const hideUrl = `${appUrl}/api/hide?token=${designer.editToken}`;

    await resend.emails.send({
      from,
      to: designer.email,
      subject: "Still looking? Your Design Better Careers profile",
      html: `
        ${EMAIL_LOGO}
        <p>Hi ${designer.firstName},</p>
        <p>Just checking in — are you still open to new opportunities?</p>
        <p>Your profile is listed on <a href="${appUrl}" style="color:#E8441C;">Design Better Careers</a>, where companies and recruiters search for senior design talent.</p>
        <p style="margin: 24px 0;">
          <a href="${confirmUrl}" style="background:#E8441C; color:#fff; padding:12px 24px; text-decoration:none; font-weight:bold; display:inline-block; margin-right:12px;">Yes, keep my profile active →</a>
        </p>
        <p>
          <a href="${hideUrl}" style="color:#909090; font-size:13px;">No thanks — hide my profile</a>
        </p>
        <p style="color:#909090; font-size:13px;">If you don't do anything, your profile will stay active. We'll check in again in 60 days.</p>
        <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />
        <p style="color:#909090; font-size:13px;">
          You're receiving this because you have a profile on <a href="${appUrl}" style="color:#E8441C;">Design Better Careers</a>.
        </p>
      `,
    });
    sent++;
  }

  return NextResponse.json({ sent, total: designers.length });
}
