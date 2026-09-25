import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { EMAIL_LOGO } from "@/lib/email-logo";

// Sending to ~350 designers sequentially needs more than the default timeout
export const maxDuration = 300;

/**
 * POST /api/admin/blast-talent
 * Sends a job digest + Portfolio Club email to all visible designers.
 * Auth: x-admin-secret header.
 *
 * Body: { dryRun?: boolean }
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = Boolean(body.dryRun);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

  // Fetch jobs — featured first, then newest, max 6
  const [jobs, totalJobs] = await Promise.all([
    db.job.findMany({
      where: { active: true, expiresAt: { gt: new Date() } },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        remote: true,
        role: true,
        typeOfRole: true,
        companyLogoUrl: true,
      },
    }),
    db.job.count({
      where: { active: true, expiresAt: { gt: new Date() } },
    }),
  ]);

  // Fetch all visible designers, excluding those who already received the first partial send
  const allDesigners = await db.designer.findMany({
    where: { publicProfile: true, hidden: false },
    select: { id: true, firstName: true, email: true, editToken: true },
  });
  const designers = allDesigners;

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      designerCount: designers.length,
      jobCount: jobs.length,
      totalJobs,
      jobs: jobs.map((j) => `${j.title} at ${j.company}`),
    });
  }

  const resend = getResend();
  const from = getFrom();
  let sent = 0;
  const errors: string[] = [];

  for (const designer of designers) {
    const unsubscribeUrl = `${appUrl}/api/hide?token=${designer.editToken}`;

    const jobRows = jobs
      .map((job) => {
        const parts: string[] = [];
        if (job.location) parts.push(job.location);
        if (job.remote) parts.push("Remote");
        const locationStr = parts.join(" · ");

        return `
          <tr>
            <td style="padding: 18px 0; border-bottom: 1px solid #EBEBEB;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${job.companyLogoUrl ? `
                  <td width="44" valign="top" style="padding-right: 14px;">
                    <img src="${job.companyLogoUrl}" alt="${job.company}" width="36" height="36"
                      style="display: block; border-radius: 8px; border: 1px solid #EBEBEB;" />
                  </td>` : ""}
                  <td valign="top">
                    <a href="${appUrl}/jobs/${job.id}"
                      style="color: #0A0A0A; font-size: 16px; font-weight: 700;
                             text-decoration: none; display: block; margin-bottom: 3px;
                             font-family: 'Helvetica Neue', Arial, sans-serif;">
                      ${job.title}
                    </a>
                    <span style="color: #767676; font-size: 14px;
                                 font-family: 'Helvetica Neue', Arial, sans-serif;">
                      ${job.company}${locationStr ? ` &nbsp;&middot;&nbsp; ${locationStr}` : ""}
                    </span>
                  </td>
                  <td valign="middle" align="right" style="padding-left: 16px; white-space: nowrap;">
                    <a href="${appUrl}/jobs/${job.id}"
                      style="display: inline-block; color: #FF4725; font-size: 13px;
                             font-weight: 600; text-decoration: none;
                             font-family: 'Helvetica Neue', Arial, sans-serif;">
                      Apply →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
      })
      .join("");

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New design jobs — Design Better Careers</title>
</head>
<body style="margin: 0; padding: 0; background: #F5F2EC;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background: #F5F2EC; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width: 600px; width: 100%; background: #ffffff;
                 border: 1px solid #E8E5E0;">

          <!-- Logo header -->
          <tr>
            <td style="padding: 32px 40px 24px; border-bottom: 1px solid #EBEBEB;">
              ${EMAIL_LOGO.replace("margin:0 0 24px;", "margin:0;")}
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 36px 40px 28px;">
              <h1 style="margin: 0 0 14px; font-size: 24px; font-weight: 700; line-height: 1.2;
                         color: #0A0A0A; letter-spacing: -0.02em;
                         font-family: 'Helvetica Neue', Arial, sans-serif;">
                New jobs on Design Better Careers
              </h1>
              <p style="margin: 0; font-size: 16px; line-height: 1.7; color: #444444;
                         font-family: 'Helvetica Neue', Arial, sans-serif;">
                Hi ${designer.firstName}, there are ${totalJobs} open design roles on Design Better
                Careers right now. Here are six worth a look.
              </p>
            </td>
          </tr>

          <!-- Jobs list -->
          <tr>
            <td style="padding: 0 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody>
                  ${jobRows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- View all CTA -->
          <tr>
            <td style="padding: 32px 40px 40px;">
              <a href="${appUrl}/jobs"
                style="display: inline-block; background: #FF4725; color: #ffffff;
                       font-size: 15px; font-weight: 700; padding: 14px 28px;
                       text-decoration: none; font-family: 'Helvetica Neue', Arial, sans-serif;">
                View all open roles →
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="height: 1px; background: #EBEBEB;"></div>
            </td>
          </tr>

          <!-- Portfolio Club -->
          <tr>
            <td style="padding: 36px 40px 40px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="border-left: 3px solid #FF4725; padding-left: 20px;">
                    <p style="margin: 0 0 8px; font-size: 11px; font-weight: 700;
                               letter-spacing: 0.1em; text-transform: uppercase; color: #FF4725;
                               font-family: 'Helvetica Neue', Arial, sans-serif;">
                      Portfolio Club
                    </p>
                    <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700;
                               color: #0A0A0A; line-height: 1.3; letter-spacing: -0.01em;
                               font-family: 'Helvetica Neue', Arial, sans-serif;">
                      A strong portfolio is your best shot at the job you want
                    </h2>
                    <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.7; color: #444444;
                               font-family: 'Helvetica Neue', Arial, sans-serif;">
                      Portfolio Club is a feature of Design Better's paid membership on Substack.
                      Design leaders—including Daniel Burka, MDS, and Bob Baxley—critique your
                      work and give you specific, actionable feedback. Bring your portfolio,
                      leave knowing exactly what to improve.
                    </p>
                    <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.7; color: #444444;
                               font-family: 'Helvetica Neue', Arial, sans-serif;">
                      Membership also includes our Slack community, Design Better books,
                      ad-free episodes, two bonus episodes each month, and our newsletters
                      The Roundup and The Brief. Take
                      <strong style="color: #0A0A0A;">20% off an annual subscription</strong>.
                    </p>
                    <a href="https://designbetterpodcast.com/82af4d0a"
                      style="display: inline-block; background: #0A0A0A; color: #ffffff;
                             font-size: 14px; font-weight: 700; padding: 12px 24px;
                             text-decoration: none;
                             font-family: 'Helvetica Neue', Arial, sans-serif;">
                      Join Portfolio Club — 20% off annual membership →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 32px; border-top: 1px solid #EBEBEB;
                        background: #F9F7F4;">
              <p style="margin: 0; font-size: 12px; color: #AAAAAA; line-height: 1.6;
                          font-family: 'Helvetica Neue', Arial, sans-serif;">
                You're receiving this because you have a profile on
                <a href="${appUrl}" style="color: #AAAAAA;">Design Better Careers</a>.
                &nbsp;&middot;&nbsp;
                <a href="${unsubscribeUrl}" style="color: #AAAAAA;">Remove my profile</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    try {
      await resend.emails.send({
        from,
        to: designer.email,
        subject: "New design jobs—and a way to get feedback on your portfolio",
        html,
      });
      sent++;
    } catch {
      errors.push(designer.email);
    }
  }

  return NextResponse.json({ sent, errors, total: designers.length, jobCount: jobs.length });
}
