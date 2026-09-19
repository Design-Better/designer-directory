import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { DesignerCard } from "@/components/DesignerCard";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Users } from "lucide-react";
import { ROLE_SEO, SEO_LOCATIONS, roleFromSlug } from "@/lib/seo";
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

  return {
    title: `Hire a ${seo.singular}`,
    description: seo.hireCopy,
    openGraph: {
      title: `Hire a ${seo.singular}`,
      description: seo.hireCopy,
    },
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/hire/${roleSlug}`,
    },
  };
}

export default async function HireRolePage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role: roleSlug } = await params;
  const roleKey = roleFromSlug(roleSlug);
  if (!roleKey) notFound();

  const seo = ROLE_SEO[roleKey];

  const designers = await db.designer.findMany({
    where: {
      publicProfile: true,
      hidden: false,
      openToWork: { not: "NOT_LOOKING" },
      primaryRole: roleKey,
    },
    orderBy: [{ openToWork: "asc" }, { createdAt: "desc" }],
    take: 12,
  });

  const otherRoles = Object.entries(ROLE_SEO)
    .filter(([key]) => key !== roleKey)
    .slice(0, 6);

  const locationLinks = Object.entries(SEO_LOCATIONS).slice(0, 8);

  return (
    <div className="min-h-screen bg-brand-gray-50">
      {/* Hero */}
      <div className="bg-brand-black text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-brand-red text-sm font-medium mb-3 uppercase tracking-wide">
            Design Better Careers
          </p>
          <h1 className="font-display text-display-md font-bold mb-4">
            Hire a {seo.singular}
          </h1>
          <p className="text-brand-gray-300 text-lg max-w-2xl mb-8">{seo.hireCopy}</p>
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/post-a-job">
              <Button className="gap-2">
                Post a Job — ${JOB_POSTING_PRICE_DOLLARS} <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2 text-brand-gray-400 text-sm">
              <Users className="w-4 h-4" />
              {designers.length} {seo.plural.toLowerCase()} available now
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* How it works */}
        <div className="grid md:grid-cols-3 gap-6 mb-14">
          {[
            {
              step: "1",
              title: "Post your role",
              body: "Describe the position and what you're looking for. Takes about 5 minutes.",
            },
            {
              step: "2",
              title: "Get matched candidates",
              body: "We score every designer in the directory and send you the best fits automatically.",
            },
            {
              step: "3",
              title: "Reach out directly",
              body: "No middleman. Contact candidates yourself and move at your own pace.",
            },
          ].map(({ step, title, body }) => (
            <div
              key={step}
              className="bg-white border border-brand-gray-100 rounded-xl p-6"
            >
              <div className="w-8 h-8 rounded-full bg-brand-red text-white text-sm font-bold flex items-center justify-center mb-4">
                {step}
              </div>
              <h3 className="font-semibold text-brand-black mb-2">{title}</h3>
              <p className="text-sm text-brand-gray-500">{body}</p>
            </div>
          ))}
        </div>

        {/* Designers grid */}
        {designers.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display font-bold text-brand-black text-xl">
                Available {seo.plural}
              </h2>
              <Link
                href={`/talent?role=${encodeURIComponent(roleKey)}`}
                className="text-sm text-brand-gray-500 hover:text-brand-black transition-colors"
              >
                Browse all →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-14">
              {designers.map((designer) => (
                <DesignerCard key={designer.id} designer={designer} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-brand-gray-400 mb-14">
            <p className="text-lg font-medium mb-2">
              No {seo.plural.toLowerCase()} listed yet.
            </p>
            <p className="text-sm">
              Post a job to reach designers through our newsletter and matching system.
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="bg-brand-black rounded-xl p-8 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-14">
          <div>
            <h3 className="font-display font-bold text-white text-xl mb-2">
              Ready to hire?
            </h3>
            <p className="text-brand-gray-400 text-sm max-w-md">
              Post a job and get a curated shortlist of matched {seo.plural.toLowerCase()}{" "}
              delivered to your inbox. Your listing runs for 60 days.
            </p>
          </div>
          <Link href="/post-a-job" className="flex-shrink-0">
            <Button className="gap-2 whitespace-nowrap">
              Post a Job — ${JOB_POSTING_PRICE_DOLLARS} <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Location cross-links */}
        <div className="mb-12">
          <h3 className="font-semibold text-brand-black mb-4">
            Hire {seo.plural.toLowerCase()} by location
          </h3>
          <div className="flex flex-wrap gap-2">
            {locationLinks.map(([, { slug, label }]) => (
              <Link
                key={slug}
                href={`/hire/${roleSlug}/${slug}`}
                className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
              >
                {slug === "remote" ? "Remote" : label}
              </Link>
            ))}
          </div>
        </div>

        {/* Other roles */}
        <div>
          <h3 className="font-semibold text-brand-black mb-4">Other design roles</h3>
          <div className="flex flex-wrap gap-2">
            {otherRoles.map(([, { slug, singular }]) => (
              <Link
                key={slug}
                href={`/hire/${slug}`}
                className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
              >
                Hire a {singular}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
