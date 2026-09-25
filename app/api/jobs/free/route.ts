import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getResend, getFrom } from "@/lib/resend";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";
import { z } from "zod";
import { EMAIL_LOGO } from "@/lib/email-logo";

const schema = z.object({
  posterFirstName: z.string().min(1),
  posterLastName: z.string().min(1),
  posterEmail: z.string().email(),
  company: z.string().min(1),
  companyUrl: z.string().url().optional().or(z.literal("")),
  title: z.string().min(1),
  role: z.string().min(1),
  location: z.string().min(1),
  remote: z.boolean().default(false),
  typeOfRole: z.string().min(1),
  experienceLevel: z.string().min(1),
  compensation: z.string().optional(),
  companySize: z.string().optional(),
  visaSponsorship: z.boolean().default(false),
  jobUrl: z.string().url().optional().or(z.literal("")),
  description: z.string().optional(),
  couponCode: z.string().min(1),
  matchFrequency: z.enum(["once", "weekly", "biweekly"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    // Re-validate coupon server-side
    const coupon = await db.coupon.findUnique({
      where: { code: data.couponCode.trim().toUpperCase() },
    });

    if (!coupon || !coupon.active) {
      return NextResponse.json({ error: "Invalid coupon code." }, { status: 400 });
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return NextResponse.json({ error: "Coupon has expired." }, { status: 400 });
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return NextResponse.json({ error: "Coupon has reached its usage limit." }, { status: 400 });
    }

    const isFree =
      (coupon.discountType === "percent" && coupon.discountValue === 100) ||
      (coupon.discountType === "fixed" && coupon.discountValue >= JOB_POSTING_PRICE_DOLLARS);

    if (!isFree) {
      return NextResponse.json({ error: "Coupon does not cover the full amount." }, { status: 400 });
    }

    // Create and immediately activate the job
    const job = await db.job.create({
      data: {
        posterFirstName: data.posterFirstName,
        posterLastName: data.posterLastName,
        posterEmail: data.posterEmail,
        company: data.company,
        companyUrl: data.companyUrl || null,
        title: data.title,
        role: data.role,
        location: data.location,
        remote: data.remote,
        typeOfRole: data.typeOfRole,
        experienceLevel: data.experienceLevel,
        compensation: data.compensation,
        companySize: data.companySize,
        visaSponsorship: data.visaSponsorship,
        jobUrl: data.jobUrl || null,
        description: data.description,
        active: true,
        stripePaymentStatus: "coupon",
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        matchFrequency: data.matchFrequency ?? "once",
      },
    });

    // Increment coupon usage
    await db.coupon.update({
      where: { id: coupon.id },
      data: { usedCount: { increment: 1 } },
    });

    // Send confirmation email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const manageUrl = `${appUrl}/api/jobs/close?token=${job.manageToken}`;
    await getResend().emails.send({
      from: getFrom(),
      to: data.posterEmail,
      subject: `Your job posting is live — ${data.title} at ${data.company}`,
      html: `
        ${EMAIL_LOGO}
        <p>Hi ${data.posterFirstName},</p>
        <p>Your job posting is live on Design Better Careers!</p>
        <p><strong>${data.title}</strong> at ${data.company}</p>
        <p><a href="${appUrl}/jobs/${job.id}?token=${job.manageToken}">View and manage your listing →</a></p>
        <p>Within 48 hours, you'll receive a curated shortlist of matched candidates. Your role will also be featured in the next edition of The Roundup newsletter.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <p style="font-size:13px;color:#888">Once the role is filled, you can remove the listing at any time:<br><a href="${manageUrl}" style="color:#888">Mark this role as filled →</a></p>
        <p>— Design Better Careers</p>
      `,
    });

    // Notify admin
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await getResend().emails.send({
        from: getFrom(),
        to: adminEmail,
        subject: `New free job posted (coupon: ${data.couponCode}) — ${data.title} at ${data.company}`,
        html: `<p>${data.posterFirstName} ${data.posterLastName} (${data.posterEmail}) posted a free job using coupon <strong>${data.couponCode}</strong>.</p><p><a href="${appUrl}/jobs/${job.id}">View listing →</a></p>`,
      });
    }

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }
    console.error("Free job error:", error);
    return NextResponse.json({ error: "Failed to create job posting." }, { status: 500 });
  }
}
