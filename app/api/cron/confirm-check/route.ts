import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { EMAIL_LOGO } from "@/lib/email-logo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

const DAYS_60 = 60 * 24 * 60 * 60 * 1000;
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const cutoff60 = new Date(now.getTime() - DAYS_60);
  const cutoff7 = new Date(now.getTime() - DAYS_7);
  // Anyone invited to job alerts in the last three weeks is mid-conversation
  // with us: the invitation is the check-in. Hiding them (or sending a second
  // nag) a day later undid the invitation for 11 designers on 2026-09-03.
  const inviteGrace = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
  const notRecentlyInvited = { OR: [{ alertInviteSentAt: null }, { alertInviteSentAt: { lt: inviteGrace } }] };

  // Phase 1: Hide profiles where confirmation email was sent 7+ days ago and still unconfirmed
  const toHide = await db.designer.findMany({
    where: {
      hidden: false,
      openToWork: { not: "NOT_LOOKING" },
      alertFrequency: "NONE", // alert subscribers are handled by the alerts flow
      AND: [notRecentlyInvited],
      confirmSentAt: { lte: cutoff7 },
      OR: [
        { lastConfirmedAt: null },
        { lastConfirmedAt: { lte: cutoff60 } },
      ],
    },
    select: { id: true, firstName: true, email: true },
  });

  for (const designer of toHide) {
    await db.designer.update({
      where: { id: designer.id },
      data: { hidden: true, confirmSentAt: null },
    });

    // Let them know their profile was hidden, with a re-confirm link
    const designer2 = await db.designer.findUnique({
      where: { id: designer.id },
      select: { editToken: true },
    });
    if (designer2) {
      const confirmUrl = `${APP_URL}/api/confirm?token=${designer2.editToken}`;
      await getResend().emails.send({
        from: getFrom(),
        to: designer.email,
        subject: "Your Design Better Careers profile has been paused",
        html: `
          ${EMAIL_LOGO}
          <p>Hi ${designer.firstName},</p>
          <p>We sent you a check-in email 7 days ago and didn't hear back, so we've temporarily hidden your profile from the directory to keep things accurate for employers.</p>
          <p>Still looking? One click to get back in:</p>
          <p><a href="${confirmUrl}" style="display:inline-block;background:#C1121F;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Reactivate my profile →</a></p>
          <p>If you've found a role and no longer need the directory, no action needed — your profile will stay hidden.</p>
          <p>— Design Better Careers</p>
        `,
      });
    }
  }

  // Phase 2: Send confirmation emails to designers due for check-in
  const toEmail = await db.designer.findMany({
    where: {
      hidden: false,
      publicProfile: true,
      openToWork: { not: "NOT_LOOKING" },
      alertFrequency: "NONE",
      AND: [notRecentlyInvited],
      confirmSentAt: null,
      OR: [
        { lastConfirmedAt: null },
        { lastConfirmedAt: { lte: cutoff60 } },
      ],
    },
    select: { id: true, firstName: true, email: true, editToken: true },
  });

  for (const designer of toEmail) {
    const confirmUrl = `${APP_URL}/api/confirm?token=${designer.editToken}`;
    const editUrl = `${APP_URL}/profile/edit?token=${designer.editToken}`;

    await getResend().emails.send({
      from: getFrom(),
      to: designer.email,
      subject: "Are you still open to opportunities?",
      html: `
        ${EMAIL_LOGO}
        <p>Hi ${designer.firstName},</p>
        <p>Your profile on Design Better Careers is listed as open to work. We just want to make sure it's still accurate — are you still looking?</p>
        <p>
          <a href="${confirmUrl}" style="display:inline-block;background:#C1121F;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Yes, I'm still looking →</a>
        </p>
        <p style="color:#888;font-size:14px;">If we don't hear from you in 7 days, we'll temporarily hide your profile to keep the directory accurate for employers. You can always reactivate with the same link above.</p>
        <p style="color:#888;font-size:14px;">Found a role or no longer looking? <a href="${editUrl}">Update your status here</a>.</p>
        <p>— Design Better Careers</p>
      `,
    });

    await db.designer.update({
      where: { id: designer.id },
      data: { confirmSentAt: now },
    });
  }

  return NextResponse.json({
    hidden: toHide.length,
    emailsSent: toEmail.length,
  });
}
