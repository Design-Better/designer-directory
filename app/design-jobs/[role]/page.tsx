import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { JobCard } from "@/components/JobCard";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Briefcase } from "lucide-react";
import { ROLE_SEO, roleFromSlug } from "@/lib/seo";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";

export const revalidate = 3600;

export async function generateStaticParams() {
  return Object.values(ROLE_SEO).map(({ slug }) => ({ role: slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ role: string }>;
}): Promise<Metadata> {
  const { role: roleSlug } = await params;
  const roleKey = roleFromSlug(roleSlug);
  if (!roleKey) return {};
  const seo = ROLE_SEO[roleKey];

  const title = `${seo.singular} Jobs`;
  const description = seo.jobsCopy;

  return {
    title,
    description,
    openGraph: { title, description },
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/design-jobs/${roleSlug}`,
    },
  };
}

export default async function JobsRolePage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role: roleSlug } = await params;
  const roleKey = roleFromSlug(roleSlug);
  if (!roleKey) notFound();

  const seo = ROLE_SEO[roleKey];

  const jobs = await db.job.findMany({
    where: {
      active: true,
      role: roleKey,
    },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
  });

  const otherRoles = Object.entries(ROLE_SEO)
    .filter(([key]) => key !== roleKey)
    .slice(0, 8);

  return (
    <div className="min-h-screen bg-brand-gray-50">
      {/* Hero */}
      <div className="bg-brand-black text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-brand-red text-sm font-medium mb-3 uppercase tracking-wide">
            Design Better Careers
          </p>
          <h1 className="font-display text-display-md font-bold mb-4">
            {seo.singular} Jobs
          </h1>
          <p className="text-brand-gray-300 text-lg max-w-2xl mb-6">{seo.jobsCopy}</p>
          <div className="flex items-center gap-2 text-brand-gray-400 text-sm">
            <Briefcase className="w-4 h-4" />
            {jobs.length} open role{jobs.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Jobs list */}
        {jobs.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display font-bold text-brand-black text-xl">
                Open {seo.singular.toLowerCase()} roles
              </h2>
              <Link href="/post-a-job">
                <Button size="sm" className="gap-1.5">
                  Post a Job <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
            <div className="flex flex-col gap-3 mb-14">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-brand-gray-400 mb-14">
            <p className="text-lg font-medium mb-2">
              No open {seo.singular.toLowerCase()} roles right now.
            </p>
            <p className="text-sm mb-8">Check back soon, or join the directory to get matched when roles open up.</p>
            <Link href="/jobs">
              <Button variant="secondary">Browse all jobs</Button>
            </Link>
          </div>
        )}

        {/* Designer CTA */}
        <div className="bg-brand-black rounded-xl p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-14">
          <div>
            <h3 className="font-display font-bold text-white text-xl mb-2">
              Are you a {seo.singular.toLowerCase()}?
            </h3>
            <p className="text-brand-gray-400 text-sm max-w-md">
              Join the directory and get matched directly with employers hiring for roles like this.
              Free to join — no password required.
            </p>
          </div>
          <Link href="/join" className="flex-shrink-0">
            <Button variant="secondary" className="gap-2 whitespace-nowrap">
              Join the directory <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Employer CTA */}
        <div className="bg-white border border-brand-gray-100 rounded-xl p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-14">
          <div>
            <h3 className="font-semibold text-brand-black text-lg mb-1">
              Hiring a {seo.singular.toLowerCase()}?
            </h3>
            <p className="text-brand-gray-500 text-sm max-w-md">
              Post a job and get a curated shortlist of matched candidates sent to your inbox. Listings run for 60 days.
            </p>
          </div>
          <Link href="/post-a-job" className="flex-shrink-0">
            <Button className="gap-2 whitespace-nowrap">
              Post a Job — ${JOB_POSTING_PRICE_DOLLARS} <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Other roles */}
        <div>
          <h3 className="font-semibold text-brand-black mb-4">Browse other design jobs</h3>
          <div className="flex flex-wrap gap-2">
            {otherRoles.map(([, { slug, singular }]) => (
              <Link
                key={slug}
                href={`/design-jobs/${slug}`}
                className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
              >
                {singular} Jobs
              </Link>
            ))}
            <Link
              href="/jobs"
              className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
            >
              All Jobs →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
