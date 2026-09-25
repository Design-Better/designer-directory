import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { z } from "zod";
import { EMAIL_LOGO } from "@/lib/email-logo";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Max 5 contact messages per IP per hour
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 5;

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

const schema = z.object({
  designerId: z.string().min(1),
  name: z.string().min(1),
  company: z.string().min(1),
  email: z.string().email(),
  message: z.string().min(10),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const data = schema.parse(body);

    const designer = await db.designer.findUnique({
      where: { id: data.designerId },
      select: { id: true, firstName: true, email: true, publicProfile: true },
    });

    if (!designer || !designer.publicProfile) {
      return NextResponse.json({ error: "Designer not found" }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const adminEmail = process.env.ADMIN_EMAIL;

    await getResend().emails.send({
      from: getFrom(),
      to: designer.email,
      replyTo: data.email,
      ...(adminEmail ? { bcc: adminEmail } : {}),
      subject: `${data.name} from ${data.company} wants to connect — Design Better Careers`,
      html: `
        ${EMAIL_LOGO}
        <p>Hi ${designer.firstName},</p>
        <p><strong>${data.name}</strong> from <strong>${data.company}</strong> saw your profile on Design Better Careers and wants to connect.</p>
        <blockquote style="border-left: 3px solid #E0E0E0; margin: 16px 0; padding: 12px 16px; color: #404040;">
          ${escapeHtml(data.message).replace(/\n/g, "<br />")}
        </blockquote>
        <p>Hit reply to respond directly — your reply goes straight to ${escapeHtml(data.name)} at ${escapeHtml(data.email)}.</p>
        <hr style="border: none; border-top: 1px solid #E0E0E0; margin: 24px 0;" />
        <p style="color: #909090; font-size: 13px;">
          You received this because you have a public profile on
          <a href="${appUrl}" style="color: #FF4725;">Design Better Careers</a>.
          <br />Want to update your profile or remove it?
          <a href="${appUrl}/profile/edit" style="color: #FF4725;">Use your edit link</a>.
        </p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }
    console.error("Contact error:", error);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }
}
