import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { DigestClient } from "./DigestClient";
import type { DigestJob } from "./DigestClient";
import { rankForDigest } from "@/lib/digest-picks";

export const dynamic = "force-dynamic";

async function checkAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (token !== process.env.ADMIN_SECRET) redirect("/admin/login");
}

/**
 * Ranked for the newsletter: best picks first, with the reasons each earned
 * its place, so the admin opens to five suggestions rather than a wall.
 * Jobs already sent in a previous digest are hidden unless ?all=1.
 */
async function getRankedJobs(includeDigested: boolean): Promise<{ jobs: DigestJob[]; digestedCount: number }> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY);
  const rows = await db.job.findMany({
    where: { active: true, createdAt: { gte: thirtyDaysAgo } },
    select: {
      id: true, title: true, company: true, location: true, remote: true, typeOfRole: true,
      compensation: true, createdAt: true, role: true, experienceLevel: true, leadership: true,
      companyLogoUrl: true, description: true, digestedAt: true,
    },
  });
  const digestedCount = rows.filter((r) => r.digestedAt).length;
  const pool = includeDigested ? rows : rows.filter((r) => !r.digestedAt);

  const ranked = rankForDigest(
    pool.map((r) => ({
      ...r,
      hasLogo: Boolean(r.companyLogoUrl),
      descriptionLength: r.description?.length ?? 0,
    })),
  );

  return {
    digestedCount,
    jobs: ranked.map(({ job, score, reasons }) => ({
      id: job.id, title: job.title, company: job.company, location: job.location, remote: job.remote,
      typeOfRole: job.typeOfRole, compensation: job.compensation, createdAt: job.createdAt.toISOString(),
      role: job.role, leadership: job.leadership, score, reasons,
      digestedAt: job.digestedAt ? job.digestedAt.toISOString() : null,
    })),
  };
}

const DAY = 24 * 60 * 60 * 1000;

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await checkAuth();
  const { all } = await searchParams;
  const includeDigested = all === "1";
  const { jobs, digestedCount } = await getRankedJobs(includeDigested);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="font-display text-display-sm font-bold text-brand-black mb-2">
        Newsletter digest
      </h1>
      <p className="text-brand-gray-500 text-sm mb-1">
        {jobs.length} job{jobs.length !== 1 ? "s" : ""} from the last 30 days, best picks first.
        The top five are already selected; swap any you don&apos;t like, then copy into Substack.
      </p>
      <p className="text-brand-gray-400 text-xs mb-8">
        {digestedCount > 0 && (
          includeDigested
            ? <>Including {digestedCount} already featured. <Link href="/admin/digest" className="underline">Hide them</Link>.</>
            : <>{digestedCount} already featured in past digests are hidden. <Link href="/admin/digest?all=1" className="underline">Show them</Link>.</>
        )}
      </p>

      {jobs.length === 0 ? (
        <div className="bg-brand-gray-50 border border-brand-gray-100 rounded-xl p-8 text-center text-brand-gray-400">
          <p className="font-medium">Nothing new to feature.</p>
          <p className="text-sm mt-1">Every job from the last 30 days has already gone out.</p>
        </div>
      ) : (
        <DigestClient jobs={jobs} appUrl={appUrl} />
      )}
    </div>
  );
}
