import { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { ROLE_SEO, SEO_LOCATIONS, HIRE_LOCATION_MIN_PROFILES } from "@/lib/seo";
import { LOCATION_ALIASES } from "@/lib/utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers";

/** Rebuilt at most hourly; jobs are ingested once a day. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [jobs, designers] = await Promise.all([
    db.job.findMany({ where: { active: true }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    db.designer.findMany({
      where: { publicProfile: true, hidden: false, openToWork: { not: "NOT_LOOKING" } },
      select: { primaryRole: true, location: true },
    }),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: APP_URL, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${APP_URL}/talent`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${APP_URL}/jobs`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${APP_URL}/join`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${APP_URL}/post-a-job`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${APP_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Every active job. Closed jobs leave the sitemap within the hour and their
  // pages carry noindex, so no JobPosting markup outlives the role.
  const jobPages: MetadataRoute.Sitemap = jobs.map((j) => ({
    url: `${APP_URL}/jobs/${j.id}`,
    lastModified: j.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const hireRolePages: MetadataRoute.Sitemap = Object.values(ROLE_SEO).map(({ slug }) => ({
    url: `${APP_URL}/hire/${slug}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.85,
  }));

  // Location pages only where they have something to show. Same rule as the
  // page's own noindex; mirrors locationWhereClause() in memory.
  const matches = (roleKey: string, locationKey: string) => {
    const terms = [locationKey, ...(LOCATION_ALIASES[locationKey] ?? [])].map((t) => t.toLowerCase());
    return designers.filter((d) => d.primaryRole === roleKey && terms.some((t) => d.location.toLowerCase().includes(t))).length;
  };
  const hireLocationPages: MetadataRoute.Sitemap = Object.entries(ROLE_SEO).flatMap(([roleKey, { slug: roleSlug }]) =>
    Object.entries(SEO_LOCATIONS)
      .filter(([locationKey]) => matches(roleKey, locationKey) >= HIRE_LOCATION_MIN_PROFILES)
      .map(([, { slug: locationSlug }]) => ({
        url: `${APP_URL}/hire/${roleSlug}/${locationSlug}`,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.75,
      })),
  );

  const jobsRolePages: MetadataRoute.Sitemap = Object.values(ROLE_SEO).map(({ slug }) => ({
    url: `${APP_URL}/design-jobs/${slug}`,
    lastModified: now,
    changeFrequency: "hourly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...jobPages, ...hireRolePages, ...hireLocationPages, ...jobsRolePages];
}
