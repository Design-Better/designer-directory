import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { cookies } from "next/headers";
import { EMAIL_LOGO } from "@/lib/email-logo";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (token !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dryRun } = await req.json();

  const designers = await db.designer.findMany({
    where: { publicProfile: true, hidden: false },
    select: { id: true, firstName: true, email: true, editToken: true },
  });

  if (dryRun) {
    return NextResponse.json({ count: designers.length, dryRun: true });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const resend = getResend();
  const from = getFrom();
  let sent = 0;
  const errors: string[] = [];

  for (const designer of designers) {
    const confirmUrl = `${appUrl}/api/confirm?token=${designer.editToken}`;
    const hideUrl = `${appUrl}/api/hide?token=${designer.editToken}`;

    try {
      await resend.emails.send({
        from,
        to: designer.email,
        subject: "Your Design Better talent profile — still looking?",
        html: `
          ${EMAIL_LOGO}
          <p>Hi ${designer.firstName},</p>

          <p>Remember when Design Better launched its talent directory last year — a place for designers to post a profile and for companies to find and hire great design talent? We're back, and we've rebuilt it from the ground up.</p>

          <p>It's now called <strong>Design Better Careers</strong>, and your profile is still listed in our directory where companies and recruiters can find you.</p>

          <p><strong>If you're still open to new opportunities</strong>, now is a great time to update your profile. We've added new fields including skills and tools, industry experience, remote preferences, and availability — all things recruiters use to find the right fit. A few minutes spent updating your profile could make a real difference.</p>

          <p>We'll be inviting companies to post job openings soon, and we want to make sure the talent side of the directory is in great shape before they arrive. Think of this as your chance to get your profile in front of employers before the doors open.</p>

          <p style="margin: 28px 0;">
            <a href="${confirmUrl}" style="background:#E8441C; color:#fff; padding:14px 28px; text-decoration:none; font-weight:bold; display:inline-block;">Review and update my profile →</a>
          </p>

          <p><strong>If you're no longer looking</strong>, no worries — you can hide your profile with one click and it won't be visible to anyone. Your information stays saved, so you can reactivate anytime you're ready.</p>

          <p><a href="${hideUrl}" style="color:#909090; font-size:13px;">Hide my profile</a></p>

          <p>Questions? Just reply to this email.</p>

          <p>— Aarron and the Design Better team</p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />
          <p style="color:#909090; font-size:13px;">
            You're receiving this because you have a profile on <a href="${appUrl}" style="color:#E8441C;">Design Better Careers</a>.
          </p>
        `,
      });
      sent++;
    } catch (e) {
      errors.push(designer.email);
    }
  }

  return NextResponse.json({ sent, errors, total: designers.length });
}
