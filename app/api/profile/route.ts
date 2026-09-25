import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { z } from "zod";
import { getCorpusStats, formatSubscribers } from "@/lib/corpus";
import { EMAIL_LOGO } from "@/lib/email-logo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const designer = await db.designer.findUnique({ where: { editToken: token } });
  if (!designer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { email, magicToken, magicTokenExpiry, ...safe } = designer;
  void email; void magicToken; void magicTokenExpiry;
  return NextResponse.json(safe);
}

const updateSchema = z.object({
  token: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  bio: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  linkedinUrl: z.string().url().optional().or(z.literal("")).nullable(),
  websiteUrl: z.string().url().optional().or(z.literal("")).nullable(),
  primaryRole: z.string().min(1),
  location: z.string().min(1),
  experienceLevel: z.string().min(1),
  typeOfRole: z.array(z.string()).default([]),
  companySize: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  startAvailability: z.string().optional(),
  remotePreference: z.string().optional(),
  compensation: z.string().optional(),
  requiresVisa: z.boolean().default(false),
  openToWork: z.enum(["OPEN", "OPEN_SOON", "NOT_LOOKING"]),
  publicProfile: z.boolean().default(true),
  shareConfidentially: z.boolean().default(false),
  photoUrl: z.string().url().optional().nullable(),
  funFacts: z.string().optional(),
  mostProudOf: z.string().optional(),
  pets: z.string().optional(),
  recentlyRead: z.string().optional(),
  languagesSpoken: z.array(z.string()).default([]),
  instruments: z.string().optional(),
  hobbies: z.string().optional(),
  projects: z.array(z.object({
    url: z.string().url(),
    description: z.string().max(200),
  })).max(5).default([]),
});

export async function DELETE(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const designer = await db.designer.findUnique({ where: { editToken: token } });
  if (!designer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.designer.delete({ where: { id: designer.id } });
  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const data = updateSchema.parse(body);

    const designer = await db.designer.findUnique({ where: { editToken: data.token } });
    if (!designer) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { token, ...updates } = data;
    void token;

    const wasNotLooking = designer.openToWork === "NOT_LOOKING";
    const nowNotLooking = updates.openToWork === "NOT_LOOKING";
    const justSwitchedToNotLooking = !wasNotLooking && nowNotLooking;

    await db.designer.update({
      where: { id: designer.id },
      data: {
        ...updates,
        linkedinUrl: updates.linkedinUrl || null,
        websiteUrl: updates.websiteUrl || null,
        photoUrl: updates.photoUrl || null,
      },
    });

    // Send success story email when designer switches to NOT_LOOKING
    if (justSwitchedToNotLooking) {
      const storyUrl = `${APP_URL}/success-story?token=${designer.editToken}`;
      const corpusStats = await getCorpusStats();
      const subscriberLabel = formatSubscribers(corpusStats?.subscribers) ?? "hundreds of thousands of";
      await getResend().emails.send({
        from: getFrom(),
        to: designer.email,
        subject: "Did Design Better Careers help you land your next role? 🎉",
        html: `
          ${EMAIL_LOGO}
          <p>Hi ${designer.firstName},</p>
          <p>Congratulations on what sounds like an exciting new chapter!</p>
          <p>We noticed you updated your status to "Not looking" — if you connected with an employer through Design Better Careers, we'd love to hear about it.</p>
          <p>Sharing your story takes 2 minutes and helps other designers see what's possible. We feature stories in our newsletter, which reaches ${subscriberLabel} readers.</p>
          <p>
            <a href="${storyUrl}" style="display:inline-block;background:#C1121F;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Share your story →</a>
          </p>
          <p style="color:#888;font-size:14px;">No pressure at all — if it wasn't through us, that's completely fine. Wishing you the best in your new role!</p>
          <p>— Design Better Careers</p>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
