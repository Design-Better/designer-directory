import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MapPin, Building2, DollarSign, ArrowLeft, ExternalLink, Clock, Globe, Settings } from "lucide-react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { formatDate } from "@/lib/utils";
import { withTracking } from "@/lib/apply-url";
import { logAlertEvent } from "@/lib/alert-events";
import { jobPostingLd } from "@/lib/job-posting-ld";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const job = await db.job.findUnique({ where: { id } });
  if (!job) return {};

  const title = `${job.title} at ${job.company}`;
  const bits = [job.location, job.remote ? "Remote OK" : null, job.compensation]
    .filter(Boolean)
    .join(" · ");
  const description = `${job.typeOfRole} · ${job.experienceLevel}${bits ? ` · ${bits}` : ""}. Apply via Design Better Careers.`;

  // openGraph must be set explicitly: without it Next merges the root layout's
  // block, so every job unfurled as the same generic site card. The image comes
  // from opengraph-image.tsx in this folder and is injected automatically.
  return {
    title, // the root layout template appends " | Design Better Careers"
    description,
    alternates: { canonical: `/jobs/${job.id}` },
    // A closed role stays reachable for people holding a link, but must not
    // be indexed: Google penalises JobPosting markup on filled roles, and the
    // markup is only rendered while the job is active.
    ...(job.active ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title,
      description,
      type: "article",
      url: `/jobs/${job.id}`,
      siteName: "Design Better Careers",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

async function incrementView(id: string) {
  await db.job.update({ where: { id }, data: { viewCount: { increment: 1 } } });
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; d?: string; utm_source?: string }>;
}) {
  const { id } = await params;
  const { token, d, utm_source } = await searchParams;
  const job = await db.job.findUnique({ where: { id } });

  if (!job) notFound();

  // Visitors from a designer email carry ?d=<designerId>. Log the view and
  // route Apply through the logging redirect; everyone else keeps the direct
  // link, so the normal board is untouched.
  if (d) logAlertEvent({ kind: "job_view", designerId: d, jobId: job.id, source: utm_source ?? null });
  const applyHref = d
    ? `/api/go/${job.id}?d=${encodeURIComponent(d)}&src=${encodeURIComponent(utm_source ?? "email")}`
    : (withTracking(job.jobUrl) ?? job.jobUrl ?? undefined);

  const isOwner = !!token && token === job.manageToken;

  // Only count views for live jobs when viewer is not the owner
  if (job.active && !isOwner) await incrementView(id);

  const manageUrl = `/api/jobs/close?token=${job.manageToken}`;
  const isExpired = job.expiresAt ? job.expiresAt < new Date() : false;

  const ld = job.active ? jobPostingLd(job, `${process.env.NEXT_PUBLIC_APP_URL ?? "https://designbetter.careers"}/jobs/${job.id}`) : null;
  return (
    <>
      {ld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      )}
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* Owner management bar */}
      {isOwner && (
        <div data-theme="dark" style={{ background: "#0A0A0A", borderBottom: "1px solid var(--divider)" }}>
          <div className="max-w-4xl mx-auto px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-2)" }}>
              <Settings className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-3)" }} />
              <span style={{ color: "var(--text-2)" }}>
                <strong style={{ color: "var(--text-1)" }}>Your listing</strong>
                {job.active && job.expiresAt && !isExpired && (
                  <> · Active until {formatDate(job.expiresAt)}</>
                )}
                {isExpired && <> · <span style={{ color: "var(--video-fg)" }}>Expired</span></>}
                {!job.active && !isExpired && <> · <span style={{ color: "var(--book-fg)" }}>Pending activation</span></>}
                {job.viewCount > 0 && <> · {job.viewCount} view{job.viewCount !== 1 ? "s" : ""}</>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/jobs/${job.id}`}
                className="text-xs transition-colors duration-[120ms]"
                style={{ color: "var(--text-3)" }}
              >
                Public view
              </a>
              {job.active && (
                <a
                  href={manageUrl}
                  className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md transition-colors duration-[120ms]"
                  style={{ background: "rgba(224,75,75,0.15)", color: "var(--video-fg)" }}
                >
                  Mark as filled
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment pending banner */}
      {!job.active && !isOwner && (
        <div style={{ background: "var(--book-bg)", borderBottom: "1px solid var(--divider)" }}>
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-2 text-sm" style={{ color: "var(--book-fg)" }}>
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span><strong>Payment pending.</strong> This listing will go live once payment is confirmed.</span>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-2 text-sm transition-colors duration-[120ms] mb-8"
          style={{ color: "var(--text-3)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Back to jobs
        </Link>

        {/* Hero */}
        <div data-theme="dark" className="p-8 mb-8 relative overflow-hidden" style={{ background: "#0A0A0A" }}>
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full translate-x-32 -translate-y-32" style={{ background: "rgba(255,71,37,0.1)" }} />
          <div className="relative">
            {job.featured && (
              <div className="mb-4">
                <Badge variant="red">Featured</Badge>
              </div>
            )}
            <div className="flex items-center gap-4 mb-4">
              <CompanyLogo companyLogoUrl={job.companyLogoUrl} company={job.company} size={52} />
              <div>
                <h1 className="font-display text-display-sm font-bold leading-tight" style={{ color: "var(--text-1)" }}>{job.title}</h1>
                <div className="flex items-center gap-2 mt-1">
                  {job.companyUrl ? (
                    <a
                      href={job.companyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-lg font-medium transition-colors duration-[120ms] flex items-center gap-1.5 hover:text-[var(--text-1)]"
                      style={{ color: "var(--text-2)" }}
                    >
                      {job.company}
                      <Globe className="w-3.5 h-3.5 opacity-60" />
                    </a>
                  ) : (
                    <p className="text-lg font-medium" style={{ color: "var(--text-2)" }}>{job.company}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-5">
              <div className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-3)" }}>
                <MapPin className="w-4 h-4" />
                {job.location}{job.remote ? " · Remote OK" : ""}
              </div>
              <div className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-3)" }}>
                <Building2 className="w-4 h-4" />
                {job.companySize ? `${job.companySize} employees` : "Company size not listed"}
              </div>
              {job.compensation && (
                <div className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-3)" }}>
                  <DollarSign className="w-4 h-4" />
                  {job.compensation}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-5">
              <Badge variant="gray">{job.typeOfRole}</Badge>
              <Badge variant="gray">{job.experienceLevel}</Badge>
              <Badge variant="gray">{job.role}</Badge>
              {job.remote && <Badge variant="green">Remote</Badge>}
              {job.visaSponsorship && <Badge variant="yellow">Visa sponsorship available</Badge>}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Description */}
          <div className="md:col-span-2 flex flex-col gap-6">
            {job.description && (
              <div className="p-6" style={{ background: "var(--surface-1)" }}>
                <h2 className="font-display font-bold mb-4" style={{ color: "var(--text-1)" }}>About this role</h2>
                <div className="leading-relaxed preserve-formatting text-sm" style={{ color: "var(--text-2)" }}>
                  {job.description}
                </div>
              </div>
            )}

            {job.jobUrl && (
              <div className="p-6" style={{ background: "var(--surface-1)" }}>
                <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
                  For full details and to apply, visit the official job listing:
                </p>
                <a href={applyHref} target="_blank" rel="noreferrer">
                  <Button className="gap-2">
                    Apply Now <ExternalLink className="w-4 h-4" />
                  </Button>
                </a>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
            {/* Apply */}
            {job.jobUrl && (
              <div className="p-5" style={{ background: "var(--surface-1)" }}>
                <p className="font-bold mb-3" style={{ color: "var(--text-1)" }}>Ready to apply?</p>
                <a href={applyHref} target="_blank" rel="noreferrer">
                  <Button size="sm" className="w-full gap-2">
                    View Full Listing <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </a>
              </div>
            )}

            {/* Details */}
            <div className="p-5" style={{ background: "var(--surface-1)" }}>
              <h3 className="font-bold mb-4" style={{ color: "var(--text-1)" }}>Job details</h3>
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Role type</p>
                  <p style={{ color: "var(--text-1)" }}>{job.typeOfRole}</p>
                </div>
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Experience level</p>
                  <p style={{ color: "var(--text-1)" }}>{job.experienceLevel}</p>
                </div>
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Category</p>
                  <p style={{ color: "var(--text-1)" }}>{job.role}</p>
                </div>
                {job.compensation && (
                  <div>
                    <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Compensation</p>
                    <p style={{ color: "var(--text-1)" }}>{job.compensation}</p>
                  </div>
                )}
                {job.companyUrl && (
                  <div>
                    <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Company</p>
                    <a
                      href={job.companyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm flex items-center gap-1 transition-colors duration-[120ms]"
                      style={{ color: "var(--signal-text)" }}
                    >
                      Visit website <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Posted</p>
                  <p style={{ color: "var(--text-1)" }}>{formatDate(job.createdAt)}</p>
                </div>
                {job.expiresAt && (
                  <div>
                    <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Active until</p>
                    <p style={{ color: isExpired ? "var(--video-fg)" : "var(--text-1)" }}>{formatDate(job.expiresAt)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Owner manage card — only shown with valid token */}
            {isOwner && (
              <div className="p-5" style={{ background: "var(--surface-1)" }}>
                <p className="font-bold text-sm mb-1" style={{ color: "var(--text-1)" }}>Manage this listing</p>
                <p className="text-xs mb-4" style={{ color: "var(--text-2)" }}>Role filled or no longer hiring? Remove it from the board.</p>
                {job.active ? (
                  <a href={manageUrl}>
                    <Button size="sm" variant="secondary" className="w-full">
                      Mark as filled
                    </Button>
                  </a>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>This listing is not currently active.</p>
                )}
                <p className="text-xs mt-3" style={{ color: "var(--text-3)" }}>
                  Questions? Email{" "}
                  <a
                    href="mailto:careers@thecuriositydepartment.com"
                    className="underline transition-colors duration-[120ms]"
                    style={{ color: "var(--text-2)" }}
                  >
                    careers@thecuriositydepartment.com
                  </a>
                </p>
              </div>
            )}

            {/* Browse talent CTA */}
            <div className="p-5" style={{ background: "var(--surface-1)" }}>
              <p className="text-sm font-bold mb-2" style={{ color: "var(--text-1)" }}>Browse our talent pool</p>
              <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>200+ senior designers actively looking for their next role.</p>
              <Link href="/talent">
                <Button size="sm" variant="secondary" className="w-full">Browse Designers</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
