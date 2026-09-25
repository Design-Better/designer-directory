import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { EMAIL_LOGO } from "@/lib/email-logo";

// Simple in-memory rate limiter: max 3 requests per IP per 15 minutes.
// Works per serverless instance — good enough to stop scripted abuse.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 3;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= MAX_REQUESTS) return true;
  entry.count++;
  return false;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    // Return 200 so we don't reveal whether the email exists
    return NextResponse.json({ sent: true });
  }

  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const designer = await db.designer.findUnique({ where: { email } });
  if (!designer) {
    // Return 200 to prevent email enumeration
    return NextResponse.json({ sent: true });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const editUrl = `${appUrl}/profile/edit?token=${designer.editToken}`;

  await getResend().emails.send({
    from: getFrom(),
    to: email,
    subject: "Edit your Design Better Careers profile",
    html: `
      ${EMAIL_LOGO}
      <h2>Edit your profile</h2>
      <p>Hi ${designer.firstName},</p>
      <p>Click the link below to edit your Design Better Careers profile:</p>
      <p><a href="${editUrl}">Edit my profile →</a></p>
      <p><em>This link doesn't expire — bookmark it for easy access.</em></p>
      <p>— Design Better Careers</p>
    `,
  });

  return NextResponse.json({ sent: true });
}
