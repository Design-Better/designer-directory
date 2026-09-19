import Link from "next/link";
import type { Metadata } from "next";
import { HeroCollage } from "@/components/HeroCollage";
import { DesignerCard } from "@/components/DesignerCard";
import { JobTable } from "@/components/JobTable";
import { db } from "@/lib/db";
import { getDirectoryCount } from "@/lib/directory";
import { Button } from "@/components/ui/Button";
import { ROLE_SEO } from "@/lib/seo";
import { ArrowRight, Users, Briefcase, Mail, Zap } from "lucide-react";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";
import { getCorpusStats, formatSubscribers, formatSubscribersShort } from "@/lib/corpus";
import type { Designer } from "@prisma/client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { alternates: { canonical: "/" } };

async function getStats() {
  const [designerCount, jobCount] = await Promise.all([
    getDirectoryCount(),
    db.job.count({ where: { active: true } }),
  ]);
  return { designerCount, jobCount };
}

const HOME_JOB_ROWS = 10;

/**
 * Newest roles, one per employer, featured first. The board ingests whole
 * career pages at once, so "newest ten" would often be ten rows from one
 * company; taking each employer's newest role keeps the sample varied.
 */
async function getRecentJobs() {
  const recent = await db.job.findMany({
    where: { active: true },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    take: 120,
  });
  const seen = new Set<string>();
  const out: typeof recent = [];
  for (const job of recent) {
    const key = job.company.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
    if (out.length >= HOME_JOB_ROWS) break;
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getFeaturedDesigners() {
  const all = await db.designer.findMany({
    where: { publicProfile: true, hidden: false, openToWork: "OPEN", photoUrl: { not: null } },
    select: {
      id: true, firstName: true, lastName: true, title: true, company: true,
      primaryRole: true, photoUrl: true, openToWork: true,
      experienceLevel: true, skills: true, location: true,
    },
  });
  return shuffle(all).slice(0, 18) as unknown as Designer[];
}

async function getHeroDesigners() {
  const all = await db.designer.findMany({
    where: { publicProfile: true, hidden: false, photoUrl: { not: null } },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
  });
  return shuffle(all).slice(0, 64) as { id: string; firstName: string; lastName: string; photoUrl: string }[];
}

export default async function HomePage() {
  const [stats, recentJobs, featuredDesigners, heroDesigners, corpusStats] = await Promise.all([
    getStats(),
    getRecentJobs(),
    getFeaturedDesigners(),
    getHeroDesigners(),
    getCorpusStats(),
  ]);
  const subscriberLabel = formatSubscribers(corpusStats?.subscribers);
  const subscriberShort = formatSubscribersShort(corpusStats?.subscribers);

  return (
    <div>
      {/* Hero — dark section */}
      <section data-theme="dark" className="py-24 px-6 relative overflow-hidden" style={{ background: "#0A0A0A" }}>
        <HeroCollage designers={heroDesigners} />
        <div className="max-w-6xl mx-auto relative z-20">
          <div className="max-w-3xl">
            <h1 className="font-display text-display-lg font-bold mb-6 text-balance" style={{ color: "var(--text-1)" }}>
              Where creative people and great companies connect.
            </h1>
            <p className="text-lg leading-relaxed mb-10 max-w-2xl" style={{ color: "var(--text-2)" }}>
              Design Better reaches {subscriberLabel ?? "hundreds of thousands of"} designers and leaders every week. We built this to connect the best of them — senior talent ready for their next move, and the teams who deserve them.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/talent">
                <Button size="lg" variant="primary" className="gap-2">
                  Browse Talent <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/post-a-job">
                {/* Ghost CTA on dark bg — paper bg, ink text. No border. */}
                <button
                  className="inline-flex items-center h-12 px-6 text-[16px] font-medium gap-2 rounded-md transition-opacity duration-[120ms] bg-[#F5F2EC] text-[#0A0A0A] hover:opacity-[0.88]"
                >
                  Post a Job — ${JOB_POSTING_PRICE_DOLLARS}
                </button>
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg">
            {subscriberShort && (
              <div>
                <p className="font-display text-display-md font-bold" style={{ color: "#FF4725" }}>{subscriberShort}</p>
                <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Newsletter readers</p>
              </div>
            )}
            <div>
              <p className="font-display text-display-md font-bold" style={{ color: "#FF4725" }}>{stats.designerCount}</p>
              <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Designers available</p>
            </div>
            <div>
              <p className="font-display text-display-md font-bold" style={{ color: "#FF4725" }}>{stats.jobCount}</p>
              <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Open roles</p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured designers */}
      {featuredDesigners.length > 0 && (
        <section className="py-20 px-6" style={{ background: "var(--surface-1)" }}>
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-10">
              <div>
                <h2 className="font-display text-display-sm font-bold" style={{ color: "var(--text-1)" }}>
                  Designers open to work
                </h2>
                <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
                  Senior designers actively looking for their next role
                </p>
              </div>
              <Link href="/talent" className="text-sm font-medium flex items-center gap-1 transition-colors duration-[120ms] hover:text-[#FF4725]" style={{ color: "var(--text-1)" }}>
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {featuredDesigners.map((designer) => (
                <DesignerCard key={designer.id} designer={designer} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent jobs */}
      {recentJobs.length > 0 && (
        <section className="py-20 px-6" style={{ background: "var(--bg)" }}>
          <div className="max-w-6xl mx-auto">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="font-display text-display-sm font-bold" style={{ color: "var(--text-1)" }}>
                  {stats.jobCount} open design roles<span style={{ color: "#FF4725" }}>.</span>
                </h2>
                <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
                  Pulled daily from company career pages. The newest from {recentJobs.length} employers:
                </p>
              </div>
              <Link href="/jobs" className="hidden sm:flex text-sm font-medium items-center gap-1 transition-colors duration-[120ms] hover:text-[#FF4725]" style={{ color: "var(--text-1)" }}>
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <JobTable
              sticky={false}
              showCompanyCount={false}
              rows={recentJobs.map((job) => ({ job, companyHref: `/jobs?company=${encodeURIComponent(job.company)}` }))}
            />

            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
              <Link href="/jobs">
                <Button size="lg" variant="secondary" className="gap-2">
                  View all {stats.jobCount} open roles <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/jobs?role=leadership" className="text-sm font-medium transition-colors duration-[120ms] hover:text-[#FF4725]" style={{ color: "var(--text-2)" }}>
                Or just the design leadership roles →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* For employers — dark section */}
      <section data-theme="dark" className="py-20 px-6" style={{ background: "#0A0A0A" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              {/* Eyebrow */}
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-4" style={{ color: "var(--signal-text)" }}>For employers</p>
              <h2 className="font-display text-display-sm font-bold mb-6 text-balance" style={{ color: "var(--text-1)" }}>
                The right designers, delivered to your inbox.
              </h2>
              <p className="leading-relaxed mb-6" style={{ color: "var(--text-2)" }}>
                Post your role and our matching engine automatically scores every designer in the directory against your criteria — role, experience level, availability, location, and more. Top matches land in your inbox on a schedule you choose.
              </p>
              {/* Frequency tag pills */}
              <div className="flex flex-wrap gap-2 mb-8">
                {["Once on go-live", "Weekly", "Bi-weekly"].map((freq) => (
                  <span key={freq} className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] rounded-full px-4 py-1" style={{ border: "1px solid var(--divider-strong)", color: "var(--text-2)" }}>{freq}</span>
                ))}
              </div>
              <Link href="/post-a-job">
                <Button size="lg" variant="primary" className="gap-2">
                  Post a Job — ${JOB_POSTING_PRICE_DOLLARS} <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {[
                { icon: Zap, title: "Automated matching", desc: "Our algorithm scores designers on role, experience, type of work, location, and availability — no manual searching." },
                { icon: Users, title: "Senior talent pool", desc: "Over 60% of our designers have 9+ years of experience. Every profile is real and self-submitted." },
                { icon: Mail, title: "Newsletter reach", desc: `New roles featured in The Roundup, sent every Friday to ${subscriberLabel ?? "hundreds of thousands of"} subscribers.` },
                { icon: Briefcase, title: "60-day listing", desc: "Active for 60 days. Update your match frequency anytime by replying to any digest email." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex gap-4 p-5" style={{ background: "var(--surface-1)" }}>
                  <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,71,37,0.15)" }}>
                    <Icon className="w-4 h-4" style={{ color: "#FF4725" }} />
                  </div>
                  <div>
                    <p className="font-bold" style={{ color: "var(--text-1)" }}>{title}</p>
                    <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Browse by role */}
      <section className="py-16 px-6" style={{ background: "#F5F2EC" }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
            <div>
              <h2 className="font-display text-display-sm font-bold" style={{ color: "var(--text-1)" }}>
                Browse by role
              </h2>
              <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
                Find designers and jobs by discipline
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(ROLE_SEO).map(([roleKey, { slug, singular, plural }]) => (
              <div key={slug} className="p-5 flex flex-col gap-3" style={{ background: "var(--surface-1)" }}>
                <p className="font-bold" style={{ color: "var(--text-1)" }}>{roleKey}</p>
                <div className="flex gap-2">
                  <Link
                    href={`/hire/${slug}`}
                    className="flex-1 text-center text-xs font-medium py-2 px-3 rounded-md transition-colors duration-[120ms] bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)]"
                  >
                    Hire a {singular}
                  </Link>
                  <Link
                    href={`/design-jobs/${slug}`}
                    className="flex-1 text-center text-xs font-medium py-2 px-3 rounded-md transition-colors duration-[120ms] bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)]"
                  >
                    {plural} Jobs
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA for talent */}
      <section className="py-20 px-6" style={{ background: "var(--bg)" }}>
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="font-display text-display-sm font-bold mb-4 text-balance" style={{ color: "var(--text-1)" }}>
            Are you a designer looking for your next role?
          </h2>
          <p className="mb-8 max-w-lg mx-auto" style={{ color: "var(--text-2)" }}>
            Add your profile to the directory. It takes 5 minutes and puts you in front of employers who are actively looking.
          </p>
          <Link href="/join">
            <Button size="lg" variant="secondary" className="gap-2">
              Add Your Profile — It&apos;s Free <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
