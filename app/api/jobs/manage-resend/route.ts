import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { z } from "zod";
import { EMAIL_LOGO } from "@/lib/email-logo";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = schema.parse(body);

    const jobs = await db.job.findMany({
      where: { posterEmail: email.toLowerCase().trim() },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        company: true,
        active: true,
        manageToken: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    // Always return success — don't leak whether an email exists
    if (jobs.length > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;

      const jobRows = jobs
        .map((job) => {
          const manageUrl = `${appUrl}/jobs/${job.id}?token=${job.manageToken}`;
          const status = !job.active
            ? "⏳ Pending activation"
            : job.expiresAt && job.expiresAt < new Date()
            ? "⛔ Expired"
            : "✅ Active";
          return `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #eee">
                <strong>${job.title}</strong> at ${job.company}<br />
                <span style="font-size:12px;color:#888">${status}</span>
              </td>
              <td style="padding:10px 0 10px 16px;border-bottom:1px solid #eee;white-space:nowrap">
                <a href="${manageUrl}" style="color:#e63329">Manage listing →</a>
              </td>
            </tr>`;
        })
        .join("");

      await getResend().emails.send({
        from: getFrom(),
        to: email,
        subject: "Your Design Better Careers job listings",
        html: `
          ${EMAIL_LOGO}
          <p>Hi there,</p>
          <p>Here are all the job listings associated with <strong>${email}</strong>. Click a link to manage any listing — you can mark it as filled or preview it.</p>
          <table style="border-collapse:collapse;width:100%;max-width:480px">
            ${jobRows}
          </table>
          <p style="margin-top:24px;font-size:13px;color:#888">These links are private — don't share them. Each link lets you manage or close that listing.</p>
          <p>— Design Better Careers</p>
        `,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    console.error("Manage resend error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
