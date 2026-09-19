import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { DesignerCard } from "@/components/DesignerCard";
import { Button } from "@/components/ui/Button";
import { ArrowRight, MapPin, Users } from "lucide-react";
import { ROLE_SEO, SEO_LOCATIONS, roleFromSlug, locationFromSlug, locationWhereClause, HIRE_LOCATION_MIN_PROFILES } from "@/lib/seo";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";

export const revalidate = 3600;

export async function generateStaticParams() {
  const params: { role: string; location: string }[] = [];
  for (const { slug: roleSlug } of Object.values(ROLE_SEO)) {
    for (const { slug: locationSlug } of Object.values(SEO_LOCATIONS)) {
      params.push({ role: roleSlug, location: locationSlug });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ role: string; location: string }>;
}): Promise<Metadata> {
  const { role: roleSlug, location: locationSlug } = await params;
  const roleKey = roleFromSlug(roleSlug);
  const locationKey = locationFromSlug(locationSlug);
  if (!roleKey || !locationKey) return {};

  const seo = ROLE_SEO[roleKey];
  const loc = SEO_LOCATIONS[locationKey];
  const locationStr = loc.preposition ? `${loc.preposition} ${loc.label}` : loc.label;

  const title = `Hire a ${seo.singular} ${locationStr}`;
  const description = `Find experienced ${seo.plural.toLowerCase()} ${locationStr}. Browse available designers and post a job to get matched candidates delivered to your inbox.`;

  // A location page with fewer than three matching profiles is a template
  // with no content. It stays reachable and linked, but is not offered to
  // search engines (app/sitemap.ts applies the same threshold).
  const matching = await db.designer.count({
    where: { publicProfile: true, hidden: false, openToWork: { not: "NOT_LOOKING" }, primaryRole: roleKey, ...locationWhereClause(locationKey) },
  });

  return {
    title,
    description,
    openGraph: { title, description },
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL}/hire/${roleSlug}/${locationSlug}`,
    },
    ...(matching < HIRE_LOCATION_MIN_PROFILES ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function HireRoleLocationPage({
  params,
}: {
  params: Promise<{ role: string; location: string }>;
}) {
  const { role: roleSlug, location: locationSlug } = await params;
  const roleKey = roleFromSlug(roleSlug);
  const locationKey = locationFromSlug(locationSlug);
  if (!roleKey || !locationKey) notFound();

  const seo = ROLE_SEO[roleKey];
  const loc = SEO_LOCATIONS[locationKey];
  const locationStr = loc.preposition ? `${loc.preposition} ${loc.label}` : loc.label;

  const designers = await db.designer.findMany({
    where: {
      publicProfile: true,
      hidden: false,
      openToWork: { not: "NOT_LOOKING" },
      primaryRole: roleKey,
      ...locationWhereClause(locationKey),
    },
    orderBy: [{ openToWork: "asc" }, { createdAt: "desc" }],
    take: 12,
  });

  // Other locations for this role
  const otherLocations = Object.entries(SEO_LOCATIONS)
    .filter(([key]) => key !== locationKey)
    .slice(0, 6);

  // Other roles for this location
  const otherRoles = Object.entries(ROLE_SEO)
    .filter(([key]) => key !== roleKey)
    .slice(0, 6);

  return (
    <div className="min-h-screen bg-brand-gray-50">
      {/* Hero */}
      <div className="bg-brand-black text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-brand-red text-sm font-medium mb-3 uppercase tracking-wide">
            Design Better Careers
          </p>
          <div className="flex items-center gap-2 text-brand-gray-400 text-sm mb-3">
            <Link href={`/hire/${roleSlug}`} className="hover:text-white transition-colors">
              Hire a {seo.singular}
            </Link>
            <span>›</span>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {loc.label}
            </div>
          </div>
          <h1 className="font-display text-display-md font-bold mb-4">
            Hire a {seo.singular} {locationStr}
          </h1>
          <p className="text-brand-gray-300 text-lg max-w-2xl mb-8">
            Browse {seo.plural.toLowerCase()} {locationStr} who are open to new opportunities.
            Post a job to get a curated shortlist matched to your role.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/post-a-job">
              <Button className="gap-2">
                Post a Job — ${JOB_POSTING_PRICE_DOLLARS} <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2 text-brand-gray-400 text-sm">
              <Users className="w-4 h-4" />
              {designers.length} designer{designers.length !== 1 ? "s" : ""} available
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Designers grid */}
        {designers.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display font-bold text-brand-black text-xl">
                {seo.plural} {locationStr}
              </h2>
              <Link
                href={`/talent?role=${encodeURIComponent(roleKey)}&location=${encodeURIComponent(locationKey)}`}
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
              No {seo.plural.toLowerCase()} listed {locationStr} yet.
            </p>
            <p className="text-sm mb-8">
              Post a job to reach designers through our newsletter and matching system.
            </p>
            <Link href={`/hire/${roleSlug}`}>
              <Button variant="secondary">
                View all {seo.plural.toLowerCase()} →
              </Button>
            </Link>
          </div>
        )}

        {/* CTA */}
        <div className="bg-brand-black rounded-xl p-8 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-14">
          <div>
            <h3 className="font-display font-bold text-white text-xl mb-2">
              Ready to hire?
            </h3>
            <p className="text-brand-gray-400 text-sm max-w-md">
              Post a job and receive a curated shortlist of matched {seo.plural.toLowerCase()}{" "}
              delivered straight to your inbox. Your listing runs for 60 days.
            </p>
          </div>
          <Link href="/post-a-job" className="flex-shrink-0">
            <Button className="gap-2 whitespace-nowrap">
              Post a Job — ${JOB_POSTING_PRICE_DOLLARS} <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Other locations for this role */}
        <div className="mb-12">
          <h3 className="font-semibold text-brand-black mb-4">
            Hire {seo.plural.toLowerCase()} in other cities
          </h3>
          <div className="flex flex-wrap gap-2">
            {otherLocations.map(([, { slug, label }]) => (
              <Link
                key={slug}
                href={`/hire/${roleSlug}/${slug}`}
                className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
              >
                {slug === "remote" ? "Remote" : label}
              </Link>
            ))}
            <Link
              href={`/hire/${roleSlug}`}
              className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
            >
              All locations →
            </Link>
          </div>
        </div>

        {/* Other roles in this location */}
        <div>
          <h3 className="font-semibold text-brand-black mb-4">
            Other design roles {locationStr}
          </h3>
          <div className="flex flex-wrap gap-2">
            {otherRoles.map(([, { slug, singular }]) => (
              <Link
                key={slug}
                href={`/hire/${slug}/${locationSlug}`}
                className="px-4 py-2 text-sm border border-brand-gray-200 rounded-full bg-white text-brand-gray-600 hover:border-brand-black hover:text-brand-black transition-colors"
              >
                {singular}s {locationStr}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
