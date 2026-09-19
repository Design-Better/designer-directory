import { db } from "@/lib/db";
import { getDirectoryCount } from "@/lib/directory";
import { notFound } from "next/navigation";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";
import { ArtisticAvatar } from "@/components/ArtisticAvatar";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ContactButton } from "@/components/ContactButton";
import { WORK_STATUS_LABELS, COMPANY_SIZES } from "@/lib/utils";
import {
  Linkedin, Globe, ArrowLeft, Share2,
  Sparkles, Trophy, PawPrint, BookOpen, Music, Smile, ExternalLink,
} from "lucide-react";

const getDesigner = cache((id: string) => db.designer.findUnique({ where: { id } }));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const designer = await getDesigner(id);
  if (!designer) return {};
  const name = `${designer.firstName} ${designer.lastName}`;
  const title = designer.title || designer.primaryRole;
  const description = designer.bio?.slice(0, 160) || `${name} — ${title} on Design Better Careers`;
  return {
    title: `${name} — ${title} | Design Better Careers`,
    description,
    openGraph: {
      title: `${name} — ${title}`,
      description,
      type: "profile",
      images: designer.photoUrl ? [{ url: designer.photoUrl, width: 400, height: 400 }] : [],
    },
    twitter: {
      card: "summary",
      title: `${name} — ${title}`,
      description,
      images: designer.photoUrl ? [designer.photoUrl] : [],
    },
  };
}

// Derive a stable 4-digit directory number from the designer's ID
function dirNumber(id: string): string {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) & 0xffff;
  return String((n % 9000) + 1000).padStart(4, "0");
}

function formatCompensation(raw: string): string {
  if (raw.includes(",")) return raw.startsWith("$") ? raw : `$${raw}`;
  const stripped = raw.replace(/[$,\s]/g, "");
  const rangeMatch = stripped.match(/^(\d+)[-–](\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1]).toLocaleString("en-US");
    const hi = parseInt(rangeMatch[2]).toLocaleString("en-US");
    return `$${lo}–$${hi}`;
  }
  const numMatch = stripped.match(/^(\d+)$/);
  if (numMatch) return `$${parseInt(numMatch[1]).toLocaleString("en-US")}`;
  return raw.startsWith("$") ? raw : `$${raw}`;
}

function parseExperience(level: string): { years: string; stage: string } {
  const m = level.match(/\((.+?)\)/);
  return {
    years: m ? m[1] : level,
    stage: level.replace(/\s*\(.+?\)/, ""),
  };
}

const STAGE_MAP = [
  { label: "Founding", range: "1–10", value: "1-10" },
  { label: "Seed",     range: "11–50",  value: "11-50" },
  { label: "Early",   range: "51–200", value: "51-200" },
  { label: "Mid",     range: "201–500", value: "201-500" },
  { label: "Growth",  range: "501–1,000", value: "501-1000" },
  { label: "Mature",  range: "1,000+", value: "1000+" },
];

export default async function DesignerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [designer, directoryCount] = await Promise.all([getDesigner(id), getDirectoryCount()]);

  if (!designer || !designer.publicProfile || designer.hidden) notFound();

  // Awaited: a fire-and-forget update was dropped when the function froze after
  // responding, which is why every profile showed zero views.
  await db.designer.update({ where: { id }, data: { profileViews: { increment: 1 } } }).catch(() => {});

  const status = WORK_STATUS_LABELS[designer.openToWork];
  const name = `${designer.firstName} ${designer.lastName}`;
  const compensation = designer.compensation ? formatCompensation(designer.compensation) : null;
  const exp = designer.experienceLevel ? parseExperience(designer.experienceLevel) : null;
  const lastEdited = designer.updatedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sizes = designer.companySize
    .flatMap((s) => s.split(",").map((v) => v.trim()))
    .filter(Boolean);
  const allSizes = sizes.length === COMPANY_SIZES.length;
  const resolvedSizes = sizes.map((s) => {
    const match = STAGE_MAP.find(
      ({ value, label }) =>
        s === value ||
        s === label ||
        s.toLowerCase().includes(label.toLowerCase()) ||
        s.replace(/\s+employees?$/i, "") === value
    );
    return match ? { label: match.label, range: match.range, key: match.value } : { label: s, range: null, key: s };
  });

  const locations = designer.location
    ? designer.location.split(/[,/]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const projects = Array.isArray(designer.projects)
    ? (designer.projects as Array<{ url: string; description: string }>).filter((p) => p.url && p.description)
    : [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const hasBeyond = designer.funFacts || designer.mostProudOf || designer.pets ||
    designer.recentlyRead || designer.languagesSpoken.length > 0 ||
    designer.instruments || designer.hobbies;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-24">

        <Link
          href="/talent"
          className="inline-flex items-center gap-2 text-sm transition-colors duration-[120ms] mb-10 text-[var(--text-3)] hover:text-[var(--text-1)]"
        >
          <ArrowLeft className="w-4 h-4" /> Back to directory
        </Link>

        {/* ── HERO ──────────────────────────────────────────── */}
        <div
          className="flex flex-col md:flex-row gap-8 md:gap-12 pb-14"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          {/* Photo */}
          <div className="flex-shrink-0 w-full md:w-56">
            <div className="relative w-full aspect-square">
              {designer.photoUrl ? (
                <Image
                  src={designer.photoUrl}
                  alt={name}
                  fill
                  className="object-cover object-top"
                  sizes="(max-width: 768px) 100vw, 224px"
                />
              ) : (
                <ArtisticAvatar seed={name} size={224} className="w-full h-full" />
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">

            {/* Status row + edit link */}
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: designer.openToWork === "OPEN" ? "var(--newsletter-fg)"
                        : designer.openToWork === "OPEN_SOON" ? "var(--book-fg)"
                        : "var(--text-3)",
                    }}
                  />
                  <span className="font-mono text-[11px] font-normal uppercase tracking-[0.12em]" style={{ color: "var(--text-2)" }}>
                    {status.label}
                  </span>
                </div>
                {designer.requiresVisa && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs font-normal uppercase tracking-[0.12em]"
                    style={{ background: "var(--book-bg)", color: "var(--book-fg)" }}
                  >
                    Requires US visa sponsorship
                  </span>
                )}
              </div>
              <Link
                href="/profile"
                className="flex-shrink-0 font-mono text-[11px] font-normal uppercase tracking-[0.12em] px-3 py-1.5 rounded transition-colors duration-[120ms] text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                Edit profile →
              </Link>
            </div>

            {/* Name */}
            <h1
              className="font-display text-6xl md:text-7xl font-bold leading-none mb-3 break-words"
              style={{ color: "var(--text-1)" }}
            >
              {name}<span style={{ color: "#FF4725" }}>.</span>
            </h1>

            {/* Title at company */}
            {(designer.title || designer.primaryRole) && (
              <p className="text-lg italic mb-6" style={{ color: "var(--text-2)" }}>
                {designer.title || designer.primaryRole}
                {designer.company && (
                  <> at <strong className="not-italic font-bold" style={{ color: "var(--text-1)" }}>{designer.company}</strong></>
                )}
              </p>
            )}

            <hr className="mb-6" style={{ borderColor: "var(--divider)" }} />

            {/* Stats grid — gap-px trick: colored parent + surface-1 children = hairline dividers */}
            <div className="grid grid-cols-2 mb-6" style={{ background: "var(--divider)", gap: "1px" }}>
              <div className="p-4" style={{ background: "var(--bg)" }}>
                <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2" style={{ color: "var(--text-3)" }}>
                  Primary Role
                </p>
                <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--signal-text)" }}>
                  {designer.primaryRole}
                </p>
              </div>
              <div className="p-4" style={{ background: "var(--bg)" }}>
                <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2" style={{ color: "var(--text-3)" }}>
                  Experience
                </p>
                {exp ? (
                  <>
                    <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--text-1)" }}>{exp.years}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>{exp.stage}</p>
                  </>
                ) : (
                  <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--text-3)" }}>—</p>
                )}
              </div>
              <div className="p-4" style={{ background: "var(--bg)" }}>
                <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2" style={{ color: "var(--text-3)" }}>
                  Open To
                </p>
                {designer.typeOfRole.length > 0 ? (
                  <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--text-1)" }}>
                    {designer.typeOfRole.join(", ")}
                  </p>
                ) : (
                  <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--text-3)" }}>—</p>
                )}
              </div>
              <div className="p-4" style={{ background: "var(--bg)" }}>
                <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2" style={{ color: "var(--text-3)" }}>
                  Desired Compensation
                </p>
                {compensation ? (
                  <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--text-1)" }}>{compensation}</p>
                ) : (
                  <p className="font-display text-2xl font-bold leading-none" style={{ color: "var(--text-3)" }}>—</p>
                )}
              </div>
            </div>

            {/* Where they work */}
            {locations.length > 0 && (
              <div className="mb-6">
                <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2" style={{ color: "var(--text-3)" }}>
                  Where they work
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {locations.map((loc, i) => (
                    <span key={i} className="flex items-center gap-x-3">
                      {i > 0 && <span className="select-none" style={{ color: "var(--divider-strong)" }}>/</span>}
                      <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--text-1)" }}>
                        <span style={{ color: "#FF4725", fontSize: "10px" }}>◆</span>
                        {loc}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* CTA buttons */}
            <div className="flex flex-wrap gap-3">
              <ContactButton designerId={designer.id} firstName={designer.firstName} />
              {designer.websiteUrl && (
                <a
                  href={designer.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-colors duration-[120ms] rounded-md hover:bg-[var(--surface-2)]"
                  style={{ background: "var(--surface-1)", color: "var(--text-1)" }}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Portfolio
                </a>
              )}
              {designer.linkedinUrl && (
                <a
                  href={designer.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-colors duration-[120ms] rounded-md hover:bg-[var(--surface-2)]"
                  style={{ background: "var(--surface-1)", color: "var(--text-1)" }}
                >
                  <Linkedin className="w-3.5 h-3.5" />
                  LinkedIn
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ── ABOUT ─────────────────────────────────────────── */}
        {designer.bio && (
          <div className="py-12">
            <div className="flex gap-8 md:gap-16">
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] w-28 flex-shrink-0 pt-1" style={{ color: "var(--text-3)" }}>
                About
              </p>
              <div className="flex-1 min-w-0">
                <p className="text-xl leading-relaxed preserve-formatting" style={{ color: "var(--text-1)" }}>{designer.bio}</p>
              </div>
              <p className="hidden md:block text-xs text-right whitespace-nowrap flex-shrink-0" style={{ color: "var(--text-3)" }}>
                Last updated<br />{lastEdited}
              </p>
            </div>
          </div>
        )}

        {/* ── AVAILABILITY & REMOTE ─────────────────────────── */}
        {(designer.startAvailability || designer.remotePreference) && (
          <div className="py-12" style={{ borderBottom: "1px solid var(--divider)" }}>
            <div className="flex gap-8 md:gap-16">
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] w-28 flex-shrink-0 pt-1" style={{ color: "var(--text-3)" }}>
                Availability
              </p>
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                {designer.startAvailability && (
                  <div>
                    <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Available to start</p>
                    <p className="font-medium" style={{ color: "var(--text-1)" }}>{designer.startAvailability}</p>
                  </div>
                )}
                {designer.remotePreference && (
                  <div>
                    <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-1" style={{ color: "var(--text-3)" }}>Remote preference</p>
                    <p className="font-medium" style={{ color: "var(--text-1)" }}>{designer.remotePreference}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── PREFERRED COMPANY SIZE ─────────────────────────── */}
        {designer.companySize.length > 0 && (
          <div className="py-12">
            <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-6" style={{ color: "var(--text-3)" }}>
              Preferred Company Size
            </p>
            <div style={{ borderTop: "1px solid var(--divider)", borderBottom: "1px solid var(--divider)" }}>
              <div className="flex flex-wrap gap-x-10 gap-y-4 py-5">
                {resolvedSizes.map(({ label, range, key }) => (
                  <div key={key} className="px-4 py-1">
                    <p className="font-display font-bold text-lg leading-tight" style={{ color: "var(--text-1)" }}>
                      {label}
                    </p>
                    {range && (
                      <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                        {range} employees
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── SKILLS & TOOLS ────────────────────────────────── */}
        {designer.skills.length > 0 && (
          <div className="py-12" style={{ borderBottom: "1px solid var(--divider)" }}>
            <div className="flex gap-8 md:gap-16">
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] w-28 flex-shrink-0 pt-1" style={{ color: "var(--text-3)" }}>
                Skills &amp; Tools
              </p>
              <div className="flex flex-wrap gap-2">
                {designer.skills.map((s) => (
                  <Badge key={s} variant="gray">{s}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── INDUSTRIES ────────────────────────────────────── */}
        {designer.industries.length > 0 && (
          <div className="py-12" style={{ borderBottom: "1px solid var(--divider)" }}>
            <div className="flex gap-8 md:gap-16">
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] w-28 flex-shrink-0 pt-1" style={{ color: "var(--text-3)" }}>
                Industries
              </p>
              <div className="flex flex-wrap gap-2">
                {designer.industries.map((ind) => (
                  <Badge key={ind} variant="gray">{ind}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── FEATURED WORK ─────────────────────────────────── */}
        {projects.length > 0 && (
          <div className="py-12" style={{ borderBottom: "1px solid var(--divider)" }}>
            <div className="flex gap-8 md:gap-16">
              <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] w-28 flex-shrink-0 pt-1" style={{ color: "var(--text-3)" }}>
                Featured Work
              </p>
              <div className="flex flex-col gap-5 flex-1">
                {projects.map((project, i) => {
                  let hostname = "";
                  try { hostname = new URL(project.url).hostname.replace(/^www\./, ""); } catch { hostname = project.url; }
                  return (
                    <a
                      key={i}
                      href={project.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-4 group"
                    >
                      <div
                        className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5 rounded transition-colors duration-[120ms] group-hover:bg-[var(--surface-alt)]"
                        style={{ background: "var(--surface-2)" }}
                      >
                        <ExternalLink className="w-3.5 h-3.5 transition-colors duration-[120ms] group-hover:text-[#FF4725]" style={{ color: "var(--text-3)" }} />
                      </div>
                      <div>
                        <p className="leading-relaxed transition-colors duration-[120ms] group-hover:text-[#FF4725]" style={{ color: "var(--text-1)" }}>{project.description}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{hostname}</p>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── BEYOND THE WORK ───────────────────────────────── */}
        {hasBeyond && (
          <div className="py-12" style={{ borderBottom: "1px solid var(--divider)" }}>
            <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-8" style={{ color: "var(--text-3)" }}>
              Beyond the Work
            </p>
            <div className="grid sm:grid-cols-2 gap-x-16 gap-y-8">
              {designer.funFacts && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <Sparkles className="w-3 h-3" style={{ color: "#FF4725" }} /> Fun facts
                  </p>
                  <p className="text-sm leading-relaxed preserve-formatting" style={{ color: "var(--text-2)" }}>{designer.funFacts}</p>
                </div>
              )}
              {designer.mostProudOf && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <Trophy className="w-3 h-3" style={{ color: "#FF4725" }} /> Most proud of
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>{designer.mostProudOf}</p>
                </div>
              )}
              {designer.pets && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <PawPrint className="w-3 h-3" style={{ color: "#FF4725" }} /> Pets
                  </p>
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>{designer.pets}</p>
                </div>
              )}
              {designer.recentlyRead && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <BookOpen className="w-3 h-3" style={{ color: "#FF4725" }} /> Recently read
                  </p>
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>{designer.recentlyRead}</p>
                </div>
              )}
              {designer.instruments && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <Music className="w-3 h-3" style={{ color: "#FF4725" }} /> Instruments
                  </p>
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>{designer.instruments}</p>
                </div>
              )}
              {designer.hobbies && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <Smile className="w-3 h-3" style={{ color: "#FF4725" }} /> Hobbies
                  </p>
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>{designer.hobbies}</p>
                </div>
              )}
              {designer.languagesSpoken.length > 0 && (
                <div>
                  <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-2 flex items-center gap-2" style={{ color: "var(--text-3)" }}>
                    <Globe className="w-3 h-3" style={{ color: "#FF4725" }} /> Languages spoken
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {designer.languagesSpoken.map((lang) => (
                      <Badge key={lang} variant="gray">{lang}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── FOOTER ACTIONS ────────────────────────────────── */}
        <div className="pt-12 flex flex-col sm:flex-row gap-10 sm:gap-16">

          {/* Hire CTA */}
          <div className="flex-1">
            <p className="font-display font-bold text-lg mb-1" style={{ color: "var(--text-1)" }}>
              Interested in hiring {designer.firstName}?
            </p>
            <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
              Post a job to reach {designer.firstName} and {Math.max(directoryCount - 1, 0)} other designers actively looking.
            </p>
            <Link
              href="/post-a-job"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold uppercase tracking-wide rounded-md transition-colors duration-[120ms] bg-[#FF4725] text-[#0A0A0A] hover:bg-[#e03d1e]"
            >
              Post a Job — ${JOB_POSTING_PRICE_DOLLARS}
            </Link>
          </div>

          {/* Share + meta */}
          <div className="flex-shrink-0">
            <p className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] mb-3" style={{ color: "var(--text-3)" }}>
              Share this profile
            </p>
            <div className="flex flex-col gap-2">
              <CopyLinkButton url={`${appUrl}/talent/${designer.id}`} />
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out ${name}'s profile on Design Better Careers`)}&url=${encodeURIComponent(`${appUrl}/talent/${designer.id}`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm transition-colors duration-[120ms] text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                <Share2 className="w-4 h-4" />
                Share on X / Twitter
              </a>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${appUrl}/talent/${designer.id}`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm transition-colors duration-[120ms] text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                <Linkedin className="w-4 h-4" />
                Share on LinkedIn
              </a>
            </div>
            {!designer.bio && (
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--divider)" }}>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>Last updated {lastEdited}</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
