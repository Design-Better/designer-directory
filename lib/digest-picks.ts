import { SOURCES, WORKDAY_SOURCES } from "@/lib/job-enrichment";

/**
 * Ranks jobs for the newsletter digest so the admin opens to five good picks
 * instead of four hundred checkboxes.
 *
 * Deliberately a transparent rubric rather than a model call: every pick shows
 * its reasons, the ranking is the same on every load, and there is nothing to
 * configure. The weights encode what the community has actually clicked on
 * (remote, listed pay, senior IC roles at recognisable companies) plus what a
 * good editorial mix needs (a leadership role, category spread, one employer
 * once).
 */

export interface DigestCandidate {
  id: string;
  title: string;
  company: string;
  role: string;
  experienceLevel: string;
  remote: boolean;
  leadership: boolean;
  compensation: string | null;
  hasLogo: boolean;
  descriptionLength: number;
  createdAt: Date;
}

export interface ScoredCandidate<T extends DigestCandidate = DigestCandidate> {
  job: T;
  score: number;
  reasons: string[];
}

const DAY = 864e5;

/** Employers we chose to crawl, as opposed to whatever an aggregator feed carried. */
const CURATED = new Set<string>([
  ...SOURCES.map((s) => s.name.trim().toLowerCase()),
  ...WORKDAY_SOURCES.map((s) => s.name.trim().toLowerCase()),
]);

/** Signals that a posting is off-brand for this community. */
const QUALITY_FLAGS = /\b(igaming|casino|gambling|betting|crypto|forex|adult|nsfw|mlm|commission[- ]only)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|lead|principal)\b/i;
const JUNIOR = /\b(associate|junior|jr\.?|intern|internship|entry)\b/i;

export function scoreForDigest(job: DigestCandidate, now = Date.now()): ScoredCandidate {
  let score = 0;
  const reasons: string[] = [];
  const ageDays = (now - job.createdAt.getTime()) / DAY;

  if (job.compensation) { score += 18; reasons.push("pay listed"); }
  if (job.remote) { score += 12; reasons.push("remote"); }
  if (CURATED.has(job.company.trim().toLowerCase())) { score += 14; reasons.push("curated employer"); }
  if (job.leadership) { score += 10; reasons.push("leadership"); }
  else if (SENIOR.test(job.title)) { score += 8; reasons.push("senior IC"); }
  if (job.hasLogo) score += 4;
  if (job.descriptionLength >= 1500) { score += 8; reasons.push("full description"); }
  else if (job.descriptionLength < 400) score -= 10;

  if (ageDays <= 7) { score += 14; reasons.push("this week"); }
  else if (ageDays <= 14) score += 8;
  else if (ageDays <= 21) score += 3;

  if (JUNIOR.test(job.title)) score -= 6;
  if (QUALITY_FLAGS.test(job.title) || QUALITY_FLAGS.test(job.company)) { score -= 40; reasons.push("flagged"); }

  return { job, score, reasons };
}

/**
 * Full ordering with editorial diversity applied greedily: an employer appears
 * once before any employer repeats, a category at most twice in any five, and
 * the first five include a leadership role when one scores within reach.
 * The client walks this list in fives, so "next 5" needs no server round trip.
 */
export function rankForDigest<T extends DigestCandidate>(jobs: T[], now = Date.now()): ScoredCandidate<T>[] {
  const scored = jobs
    .map((j) => ({ ...scoreForDigest(j, now), job: j }))
    .sort((a, b) => b.score - a.score || b.job.createdAt.getTime() - a.job.createdAt.getTime());

  const out: ScoredCandidate<T>[] = [];
  const remaining = [...scored];
  const employerSeen = new Set<string>();

  while (remaining.length) {
    const window = out.slice(-4); // the four already in this block of five
    const catCount = (role: string) => window.filter((w) => w.job.role === role).length;
    const blockHasLeader = window.some((w) => w.job.leadership);
    const positionInBlock = out.length % 5;

    let idx = remaining.findIndex((c) => {
      const key = c.job.company.trim().toLowerCase();
      if (employerSeen.has(key) && employerSeen.size < new Set(remaining.map((r) => r.job.company.trim().toLowerCase())).size) return false;
      if (catCount(c.job.role) >= 2) return false;
      // Last slot of a block with no leader yet: prefer a leadership role if one is close.
      if (positionInBlock === 4 && !blockHasLeader && !c.job.leadership) {
        const leader = remaining.find((r) => r.job.leadership && !employerSeen.has(r.job.company.trim().toLowerCase()) && r.score >= c.score - 15);
        if (leader) return false;
      }
      return true;
    });
    if (idx === -1) idx = 0; // constraints exhausted; take the best that's left

    const [pick] = remaining.splice(idx, 1);
    employerSeen.add(pick.job.company.trim().toLowerCase());
    out.push(pick);
  }
  return out;
}
