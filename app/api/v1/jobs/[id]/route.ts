import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withTracking } from "@/lib/apply-url";

/** GET /api/v1/jobs/{id} — one active job with its full description. See docs/jobs-api.md. */

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

  const j = await db.job.findFirst({
    where: { id, active: true },
    select: {
      id: true, title: true, company: true, companyUrl: true, companyLogoUrl: true, companySize: true,
      location: true, remote: true, role: true, experienceLevel: true, typeOfRole: true,
      compensation: true, leadership: true, visaSponsorship: true, featured: true,
      createdAt: true, expiresAt: true, jobUrl: true, description: true,
    },
  });
  if (!j) {
    return NextResponse.json({ ok: false, error: "Not found or no longer active" }, { status: 404, headers: CORS });
  }

  return NextResponse.json(
    {
      ok: true,
      job: {
        id: j.id,
        title: j.title,
        company: j.company,
        companyUrl: j.companyUrl,
        companyLogoUrl: j.companyLogoUrl,
        companySize: j.companySize,
        location: j.location,
        remote: j.remote,
        role: j.role,
        experienceLevel: j.experienceLevel,
        typeOfRole: j.typeOfRole,
        compensation: j.compensation,
        leadership: j.leadership,
        visaSponsorship: j.visaSponsorship,
        featured: j.featured,
        postedAt: j.createdAt.toISOString(),
        expiresAt: j.expiresAt ? j.expiresAt.toISOString() : null,
        url: `${base}/jobs/${j.id}`,
        applyUrl: withTracking(j.jobUrl) ?? j.jobUrl,
        description: j.description ?? null,
      },
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600", ...CORS } },
  );
}
