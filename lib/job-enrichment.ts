/**
 * job-enrichment.ts
 *
 * Single source of truth for pulling design jobs off ATS boards / job boards
 * and turning them into complete Job rows: description, compensation, role
 * category, and a high-resolution company logo.
 *
 * Used by:
 *   - app/api/cron/fetch-jobs      (daily ingest)
 *   - app/api/admin/enrich-jobs    (backfill for rows missing data)
 */

import { PRIMARY_ROLES } from "@/lib/utils";

// ── Small utilities ────────────────────────────────────────────────────────

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
  middot: "·", eacute: "é", rsaquo: "›", trade: "™", reg: "®", copy: "©",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Convert (possibly entity-escaped) HTML into readable plain text with
 * paragraph breaks preserved — the job detail page renders description as
 * text with `white-space: pre-wrap`, so no markup may survive.
 */
export function htmlToText(input: string | null | undefined): string | null {
  if (!input) return null;
  // Greenhouse double-encodes: "&lt;p&gt;..." — decode before stripping tags.
  let s = input;
  if (/&lt;|&gt;|&amp;lt;/.test(s)) s = decodeEntities(s);

  s = s
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|header|footer)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");

  s = decodeEntities(s);

  return s
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || null;
}

// ── Role / level classification ───────────────────────────────────────────

const DESIGN_KEYWORDS = [
  "product designer", "ux designer", "ui designer", "visual designer",
  "motion designer", "brand designer", "graphic designer",
  "design lead", "design director", "design manager", "head of design",
  "vp of design", "vp, design", "chief design officer",
  "design engineer", "design technologist", "design systems engineer",
  "ux engineer", "ux researcher", "user researcher",
  "content designer", "ux writer",
  "industrial designer", "icon designer",
  "illustrat",
];

const DESIGN_ROLE_PATTERNS = [
  /\bdesigner\b/,
  /\bdesign\s+(lead|director|manager|engineer|technologist|systems|ops|operations)\b/,
  /\bhead\s+of\s+design\b/,
  /\b(ux|ui|product|visual|motion|brand|graphic|content)\s+design/,
  /\buser\s+(experience|research)\s+design/,
  /\binteraction\s+design(er)?\b/,
  /\bdesign\s+researcher\b/,
  /\bindustrial design\b/,
  /\b(creative|brand|art)\s+(?:and\s+\w+\s+)?lead\b/,
];

/**
 * Titles containing a design word that are not design work. Drawn from live
 * false positives, and consulted by BOTH isDesignRole and isLeadershipRole:
 * "Incentive Design Manager" matches the plain "design manager" keyword, so a
 * leadership-only exclusion never gets a say. Deliberately narrow, so real
 * roles like "Product Designer, Compensation" at an HR product company survive.
 */
const NON_DESIGN_TITLES: RegExp[] = [
  /\bdesign\s*(?:&|and)\s*construction\b/i, // facilities, not design
  /\bfacilities\b/i,
  /\bincentive design\b/i,
  /\bcompensation\s+(?:strategy|manager|analyst|partner)\b/i,
  /\bpolicy design\b/i,
  /\bcourse director\b/i,
  /\bcurriculum\b/i,
  // A "Brand Manager" markets the brand; a "Brand Design Manager" or
  // "Creative Director, Brand" designs it. Only the bare marketing form goes.
  /\b(?<!design\s)(?<!creative\s)brand\s+manager\b/i,
  /\btalent brand\b/i,
  // Engineering disciplines that happen to contain "design engineer".
  /\b(precast|civil|structural|hvac|mechanical|electrical|plumbing)\s+design\b/i,
  /\bprecast\b/i,
  // Teaching design isn't a design job.
  /\b(instructor|teacher|tutor|professor|lecturer)\b/i,
  // Chip and systems engineering. Workday searches at hardware companies return
  // hundreds of these, and "design engineer" alone can't tell them apart.
  /\b(asic|rtl|fpga|vlsi|soc|silicon|analog|mixed[- ]signal|circuit|dft|synthesis|semiconductor|firmware|pcb)\b/i,
  /\bphysical design\b/i,
  /\bsystems?\s+design\s*(?:\/|engineer|architect)/i, // "System Design Engineer"; "Design Systems" is fine
  // Learning & development, not product.
  /\b(learning|instructional)\s+(experience\s+)?design/i,
  /\bchip\s+design\b/i,
  // Design fields outside this board's audience.
  /\b(apparel|fashion|footwear|textile|garment|jewel)/i,
  /\b(landscape|interior|architectural)\s+design/i,
  /\barchitecture\s*(?:&|and)\s*engineering\b/i,
];

const DESIGN_EXCLUSIONS = [
  /engineer.*experience\s+platform/i,
  /sales\s+compensation\s+design/i,
  /channel\s+sales/i,
  /linux.*engineer/i,
  /security\s+engineer/i,
  /software\s+engineer.*new\s+grad/i,
  /full\s+stack\s+engineer/i,
  /\bdata\s+cent(er|re)\b/i,
  /\bmechanical\s+engineer\b/i,
  /\bdesign\s+verification\b/i,
  ...NON_DESIGN_TITLES,
];

// ── Design leadership ─────────────────────────────────────────────────────
// Leadership is orthogonal to discipline — you can lead product design or
// brand — so it lives in its own flag rather than in the role category.

const LEAD_DISCIPLINE =
  "(?:product\\s+design|experience\\s+design|design\\s+systems|design\\s+operations|" +
  "user\\s+experience|user\\s+research|content\\s+design|design|ux|ui|brand|creative|art|visual|motion|graphic)";
const LEAD_RANK = "(?:head|vp|vice\\s+president|svp|evp|chief|director|manager)";
/** Up to two qualifier words, so "Director of Global Product Design" still matches. */
const LEAD_QUALIFIER = "(?:[a-z]+\\s*[-–—,]?\\s+){0,3}"; // "Manager, People Leader - Product Design"

const LEADERSHIP_PATTERNS: RegExp[] = [
  new RegExp(`\\b${LEAD_RANK}\\b[^,]{0,18}\\bof\\b\\s+${LEAD_QUALIFIER}${LEAD_DISCIPLINE}\\b`, "i"),
  new RegExp(`\\b${LEAD_RANK}\\b\\s*,?\\s+${LEAD_QUALIFIER}${LEAD_DISCIPLINE}\\b`, "i"),
  new RegExp(`\\b${LEAD_DISCIPLINE}\\s+${LEAD_QUALIFIER}${LEAD_RANK}\\b`, "i"),
  /\bcreative director\b/i,
  /\bart director\b/i,
  /\bchief design officer\b/i,
  /\bdesign\s+lead(?:er)?\b/i, // "Product Design Lead" is a team lead; "Lead Product Designer" (no match) is a senior IC
];

/**
 * Titles that carry a leadership word but aren't design leadership. Without
 * these, "Manager, Software Engineering", "Founding Growth Product Manager" and
 * "Director of Customer Experience" all read as design leaders.
 */
const LEADERSHIP_EXCLUSIONS: RegExp[] = [
  /\b(customer|employee|candidate|patient|client|partner|developer|seller|merchant)\s+experience\b/i,
  /\bsoftware engineering\b/i,
  /\bengineering manager\b/i,
  /\b(product|program|project|technical|account|marketing|community|sales|engineering)\s+manager\b/i,
  /\bpolicy design\b/i,
  /\baccount director\b/i,
  /\bmarketing director\b/i,
  /\bsales\b/i,
  /\btechnical game design\b/i, // game engineering dressed as design
  /\bindividual contributor\b/i, // Capital One titles senior ICs "Senior Manager, Individual Contributor"
  ...NON_DESIGN_TITLES,
];

/** True for roles that lead a design function (people or org), not senior ICs. */
export function isLeadershipRole(title: string): boolean {
  const lower = title.toLowerCase();
  if (LEADERSHIP_EXCLUSIONS.some((re) => re.test(lower))) return false;
  return LEADERSHIP_PATTERNS.some((re) => re.test(lower));
}

export function isDesignRole(title: string): boolean {
  const lower = title.toLowerCase();
  // CMF (colour, material, finish) is industrial design; the apparel rule would
  // otherwise reject "CMF Designer II (Accessories & Apparel)".
  if (/\bcmf\b/.test(lower)) return true;
  if (DESIGN_EXCLUSIONS.some((re) => re.test(lower))) return false;
  if (DESIGN_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (DESIGN_ROLE_PATTERNS.some((re) => re.test(lower))) return true;
  // Leadership titles frequently omit the literal word "design" — "Head of UX",
  // "Creative Director", "Director, User Experience". Twelve of twenty-five
  // realistic leadership titles were being dropped at ingest before this.
  return isLeadershipRole(title);
}

const VALID_ROLES = new Set<string>(PRIMARY_ROLES as readonly string[]);

/**
 * Map a job title onto one of PRIMARY_ROLES. Only these values are selectable
 * in the board's Role filter, so anything else makes a job unfilterable.
 */
export function mapRole(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("motion") || t.includes("animator") || t.includes("animation")) return "Motion Design";
  if (t.includes("illustrat")) return "Illustration";
  if (t.includes("design system") || t.includes("design technologist") ||
      t.includes("ux engineer") || t.includes("design engineer") ||
      t.includes("frontend") || t.includes("front-end")) return "Design Systems";
  if (t.includes("designops") || t.includes("design ops")) return "DesignOps";
  if (t.includes("research")) return "User Research";
  if (t.includes("service design")) return "Service Design";
  if (t.includes("brand") || t.includes("graphic") || t.includes("packaging") ||
      t.includes("marketing") || t.includes("advertis") || t.includes("presentation")) return "Branding";
  if (t.includes("content design") || t.includes("ux writer") || t.includes("copywriter")) return "UX/UI Design";
  if (t.includes("product manager") || t.includes("product management")) return "Product Management";
  if (t.includes("industrial design")) return "Other";
  if (t.includes("ux") || t.includes("ui") || t.includes("interaction") ||
      t.includes("user experience") || t.includes("web design")) return "UX/UI Design";
  if (t.includes("product design")) return "Product Design";
  if (t.includes("visual design")) return "UX/UI Design";
  return "Product Design";
}

/** Coerce a legacy/free-form role value into a valid PRIMARY_ROLES entry. */
export function normalizeRole(role: string | null | undefined, title: string): string {
  if (role && VALID_ROLES.has(role)) return role;
  const legacy: Record<string, string> = {
    "Visual Design": "UX/UI Design",
    "UX Research": "User Research",
    "Design Management": "Product Design",
    "Industrial Design": "Other",
    "Graphic Design": "Branding",
    "Interaction Design": "UX/UI Design",
    "Content Design": "UX/UI Design",
  };
  if (role && legacy[role]) return legacy[role];
  return mapRole(title);
}

export function mapExperience(title: string): string {
  const t = title.toLowerCase();
  if (/\b(vp|vice president|director|principal|staff|lead|head of|chief|senior staff|senior director)\b/.test(t)) {
    return "Late Career (9+ years)";
  }
  if (/\b(junior|associate|jr\.?|entry|new grad|intern)\b/.test(t)) {
    return "Early Career (0-2 years)";
  }
  return "Mid Career (3-8 years)";
}

export function mapTypeOfRole(raw: string | null | undefined, title: string): string {
  const s = `${raw ?? ""} ${title}`.toLowerCase();
  if (/\bpart[\s-]?time\b/.test(s)) return "Part-time";
  if (/\bcontract|contractor|freelance|temporary\b/.test(s)) return "Contract";
  return "Full-time";
}

// ── Compensation ──────────────────────────────────────────────────────────

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", CAD: "CA$", GBP: "£", EUR: "€", AUD: "A$", INR: "₹", SGD: "S$",
};

function intervalSuffix(interval: string | null | undefined): string {
  const i = (interval ?? "").toLowerCase();
  if (i.includes("hour")) return "/hr";
  if (i.includes("week")) return "/wk";
  if (i.includes("month")) return "/mo";
  if (i.includes("day")) return "/day";
  return "/yr";
}

export function formatSalaryRange(r: {
  min?: number | null; max?: number | null; currency?: string | null; interval?: string | null;
} | null | undefined): string | null {
  if (!r) return null;
  const min = r.min && r.min > 0 ? r.min : null;
  const max = r.max && r.max > 0 ? r.max : null;
  if (!min && !max) return null;
  const cur = (r.currency ?? "USD").toUpperCase();
  const sym = CURRENCY_SYMBOL[cur] ?? `${cur} `;
  const fmt = (n: number) => n >= 1000 ? `${sym}${Math.round(n / 1000)}k` : `${sym}${n}`;
  const suffix = intervalSuffix(r.interval);
  if (min && max) return `${fmt(min)}–${fmt(max)}${suffix}`;
  return `${fmt((min ?? max)!)}${suffix}`;
}

/**
 * Pull a salary range out of free-text description copy. Deliberately
 * conservative — a wrong number is worse than none, so it only accepts an
 * explicit two-sided range with a currency symbol and plausible magnitudes.
 */
export function extractCompensation(text: string | null | undefined): string | null {
  if (!text) return null;
  const rx = /([$£€])\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?\s?[kK])\s*(?:-{1,2}|–|—|\bto\b)\s*([$£€])?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?\s?[kK])/;
  const m = rx.exec(text);
  if (!m) return null;

  const parse = (raw: string): number | null => {
    const v = raw.replace(/,/g, "").trim();
    if (/[kK]$/.test(v)) {
      const n = parseFloat(v.replace(/\s?[kK]$/, ""));
      return Number.isFinite(n) ? n * 1000 : null;
    }
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  const lo = parse(m[2]);
  const hi = parse(m[4]);
  if (!lo || !hi || hi < lo) return null;
  // Plausible annual salary band only.
  if (lo < 30_000 || hi > 1_500_000) return null;

  const sym = m[1];
  const cur = sym === "£" ? "GBP" : sym === "€" ? "EUR" : "USD";
  return formatSalaryRange({ min: lo, max: hi, currency: cur, interval: "year" });
}

// ── High-resolution logo resolution ───────────────────────────────────────

type ImgMeta = { type: string; w: number; h: number; vector: boolean };

/** Read intrinsic dimensions straight out of the image bytes. */
export function imageMeta(buf: ArrayBuffer): ImgMeta | null {
  const b = new Uint8Array(buf);
  if (b.length < 16) return null;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.slice(0, 600));
  if (/<svg[\s>]/i.test(head)) return { type: "svg", w: Infinity, h: Infinity, vector: true };

  const dv = new DataView(buf);
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: "png", w: dv.getUint32(16), h: dv.getUint32(20), vector: false };
  }
  // GIF
  if (head.startsWith("GIF8")) {
    return { type: "gif", w: dv.getUint16(6, true), h: dv.getUint16(8, true), vector: false };
  }
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8X") {
      return { type: "webp", w: (dv.getUint32(24, true) & 0xffffff) + 1, h: ((dv.getUint32(26, true) >> 8) & 0xffffff) + 1, vector: false };
    }
    if (fourcc === "VP8 ") {
      return { type: "webp", w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff, vector: false };
    }
    if (fourcc === "VP8L") {
      const bits = dv.getUint32(21, true);
      return { type: "webp", w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, vector: false };
    }
    return null;
  }
  // ICO — report the largest embedded image
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    const n = b[4] | (b[5] << 8);
    let w = 0, h = 0;
    for (let i = 0; i < n; i++) {
      const off = 6 + i * 16;
      if (off + 1 >= b.length) break;
      const ew = b[off] === 0 ? 256 : b[off];
      const eh = b[off + 1] === 0 ? 256 : b[off + 1];
      if (ew * eh > w * h) { w = ew; h = eh; }
    }
    return { type: "ico", w, h, vector: false };
  }
  // JPEG — walk to the first SOFn frame header
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: "jpeg", h: dv.getUint16(i + 5), w: dv.getUint16(i + 7), vector: false };
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len <= 0) break;
      i += 2 + len;
    }
  }
  return null;
}

const MIN_LONG_EDGE = 128;
// Wordmarks are the real logo for plenty of companies (a 374x51 lockup, say),
// and `object-contain` renders them fine, so the short edge stays permissive.
// The aspect cap is what rejects decorative slivers and banner strips.
const MIN_SHORT_EDGE = 24;
const MAX_ASPECT = 8;
/**
 * Byte-per-pixel floor used ONLY for favicon services. Google's endpoint will
 * resize a 32px favicon up to any requested size, producing a large but blurry
 * PNG; those land near 0.02–0.03 B/px while real artwork sits well above.
 * Site-declared assets skip this check — a flat logo can legitimately be tiny.
 */
const MIN_DENSITY = 0.045;

type Scored = { ok: true; meta: ImgMeta; quality: number; why: string } | { ok: false; why: string };

/**
 * An SVG is only usable if it actually closes. unavatar.io intermittently
 * returns truncated bodies, and because `imageMeta` recognises "<svg" from the
 * first few hundred bytes those scored as a perfect vector and beat every other
 * candidate — producing logos no browser could decode.
 */
function svgIsWellFormed(buf: ArrayBuffer): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!/<\/svg\s*>/i.test(text)) return false;
  // Needs at least one drawable element to be worth storing.
  return /<(path|rect|circle|ellipse|polygon|polyline|line|text|image|use|g)\b/i.test(text);
}

export function scoreImage(buf: ArrayBuffer, authentic: boolean): Scored {
  const meta = imageMeta(buf);
  if (!meta) return { ok: false, why: "unrecognized format" };
  if (meta.vector) {
    if (!svgIsWellFormed(buf)) return { ok: false, why: "truncated/empty svg" };
    return { ok: true, meta, quality: 4096, why: "vector" };
  }
  const { w, h } = meta;
  if (!w || !h) return { ok: false, why: "no dimensions" };
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long < MIN_LONG_EDGE || short < MIN_SHORT_EDGE) return { ok: false, why: `too small ${w}x${h}` };
  if (long / short > MAX_ASPECT) return { ok: false, why: `too elongated ${w}x${h}` };
  const density = buf.byteLength / (w * h);
  if (!authentic && density < MIN_DENSITY) {
    return { ok: false, why: `upscaled favicon (${w}x${h} @ ${density.toFixed(3)} B/px)` };
  }
  return { ok: true, meta, quality: long, why: `${w}x${h}` };
}

const UA = "Mozilla/5.0 (compatible; DesignBetterCareers/1.0; +https://designbetter.careers)";

/** GET with one retry when the host answers "slow down" rather than "no". */
async function politeFetch(
  url: string,
  { timeoutMs = 10000, accept = "*/*", tries = 2 } = {},
): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": UA, Accept: accept },
      });
      if ((res.status === 429 || res.status === 503) && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
        continue;
      }
      return res;
    } catch {
      if (i === tries - 1) return null;
    }
  }
  return null;
}

/** Inline SVG logos are carried as data: URIs so they flow through unchanged. */
function decodeDataUri(url: string): { buf: ArrayBuffer; contentType: string } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(url);
  if (!m) return null;
  try {
    const [, contentType, isB64, payload] = m;
    const bytes = isB64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { buf, contentType };
  } catch { return null; }
}

async function fetchImage(url: string, timeoutMs = 10000): Promise<{ buf: ArrayBuffer; contentType: string } | null> {
  if (url.startsWith("data:")) {
    const decoded = decodeDataUri(url);
    return decoded && decoded.buf.byteLength >= 80 ? decoded : null;
  }
  const res = await politeFetch(url, { timeoutMs, accept: "image/*,*/*" });
  if (!res || !res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!/image|svg|octet-stream/i.test(contentType)) return null;
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 200) return null;
    return { buf, contentType };
  } catch { return null; }
}

/**
 * Image proxies hide the real asset either behind a `url` query param
 * (Next.js) or by embedding the full URL in the path (RemoteOK's resize-cgi,
 * Cloudflare image resizing). Unwrapping reaches the full-resolution original.
 */
function unwrapImageProxy(url: string): string {
  try {
    const u = new URL(url);
    const inner = u.searchParams.get("url");
    if (inner && /\/_next\/image|\/_vercel\/image|\/cdn-cgi\/image/.test(u.pathname)) {
      return new URL(inner, u.origin).href;
    }
    // ".../resize-cgi/image/width=300/https://r2.example.com/real.webp"
    const embedded = /(https?:\/\/.+)$/.exec(u.pathname.slice(1));
    if (embedded) {
      const candidate = embedded[1];
      if (/^https?:\/\/[^/]+\./.test(candidate)) return candidate;
    }
  } catch { /* fall through */ }
  return url;
}

/**
 * Find the company's own logo in page markup — often an SVG or a large
 * wordmark, and the only decent asset on sites that ship just a 32px favicon.
 *
 * Requires the company's own name to appear in the tag, so a "trusted by"
 * strip of client logos can't hand us somebody else's mark.
 */
/**
 * Many modern sites render their logo as an inline <svg> rather than an image
 * file, leaving nothing fetchable (Luma AI ships only a 48px .ico otherwise).
 * Lift the markup out and carry it as a data: URI.
 */
function inlineSvgCandidates(html: string, company: string): Candidate[] {
  const out: Candidate[] = [];
  const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);

  for (const m of html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    const svg = m[0];
    const open = svg.slice(0, svg.indexOf(">") + 1);
    // "logo" in the attributes is what separates a brand mark from the dozens
    // of decorative icons a page inlines.
    if (!/logo|wordmark|brand/i.test(open)) continue;
    if (svg.length > 120_000 || svg.length < 80) continue;
    // A nested <svg> would have truncated the match; skip those.
    if (/<svg\b/i.test(svg.slice(open.length))) continue;

    const withNs = /xmlns=/i.test(open)
      ? svg
      : svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    const named = tokens.some((t) => open.toLowerCase().includes(t));

    out.push({
      url: `data:image/svg+xml;base64,${Buffer.from(withNs, "utf8").toString("base64")}`,
      hint: named ? 950 : 400,
      src: named ? "inline-svg(named)" : "inline-svg",
      authentic: true,
    });
    if (out.length >= 3) break;
  }
  return out.sort((a, b) => b.hint - a.hint);
}

function markupLogoCandidates(html: string, base: string, company: string): Candidate[] {
  const out: Candidate[] = [];
  const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const compact = company.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/logo|brand|wordmark/i.test(tag)) continue;
    const alt = /alt=["']([^"']*)/i.exec(tag)?.[1] ?? "";
    const src = /\bsrc=["']([^"']+)/i.exec(tag)?.[1];
    const srcset = /srcset=["']([^"']+)/i.exec(tag)?.[1];
    // Lazy-loaded logos keep a placeholder in src and the real file in a data
    // attribute — RemoteOK's job pages do exactly this.
    const lazy = /\bdata-(?:src|original|lazy-src|lazy)=["']([^"']+)/i.exec(tag)?.[1];

    const hay = `${alt} ${src ?? ""} ${srcset ?? ""} ${lazy ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!(tokens.some((t) => hay.includes(t)) || hay.includes(compact))) continue;

    const raw: string[] = [];
    if (lazy) raw.push(lazy);
    if (src && !/pixel\.gif|placeholder|data:image\/gif/i.test(src)) raw.push(src);
    if (srcset) {
      const widest = srcset
        .split(",")
        .map((s) => s.trim().split(/\s+/))
        .sort((a, b) => (parseInt(b[1] ?? "0", 10) || 0) - (parseInt(a[1] ?? "0", 10) || 0))[0]?.[0];
      if (widest) raw.push(widest);
    }

    for (const r of raw) {
      const abs = absolutize(r, base);
      if (!abs) continue;
      const real = unwrapImageProxy(abs);
      out.push({
        url: real,
        hint: /\.svg($|\?)/i.test(real) ? 900 : 300,
        src: "markup-logo",
        authentic: true,
      });
    }
  }
  return out;
}

function absolutize(href: string, base: string): string | null {
  try { return new URL(href, base).href; } catch { return null; }
}

type Candidate = { url: string; hint: number; src: string; authentic: boolean };

/**
 * Discover the icons a company declares about itself: web-app-manifest icons
 * (often 512px) and apple-touch-icons (usually >=180px). These are real
 * artwork, unlike anything a favicon service synthesizes.
 */
// Scanning a company's site is the expensive step and its result never varies
// per posting, so it is cached separately from the per-posting resolution.
const siteScanMemo = new Map<string, Promise<Candidate[]>>();

function siteIconCandidates(domain: string, company?: string | null): Promise<Candidate[]> {
  const key = `${domain}|${company ?? ""}`;
  const hit = siteScanMemo.get(key);
  if (hit) return hit;
  const task = scanSiteIcons(domain, company).catch(() => [] as Candidate[]);
  siteScanMemo.set(key, task);
  return task;
}

async function scanSiteIcons(domain: string, company?: string | null): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const base of [`https://${domain}`, `https://www.${domain}`]) {
    const res = await politeFetch(base, { timeoutMs: 12000, accept: "text/html,*/*" });
    if (!res || !res.ok) continue;
    let html: string;
    try { html = await res.text(); } catch { continue; }

    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      const rel = (/rel=["']?([^"'>]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
      const href = /href=["']([^"']+)/i.exec(tag)?.[1];
      if (!href) continue;
      const sizeM = /sizes=["']?(\d+)x(\d+)/i.exec(tag);
      const dim = sizeM ? parseInt(sizeM[1], 10) : 0;

      if (/apple-touch-icon/.test(rel)) {
        const u = absolutize(href, base);
        if (u) out.push({ url: u, hint: dim || 180, src: "apple-touch-icon", authentic: true });
      } else if (/mask-icon/.test(rel)) {
        const u = absolutize(href, base);
        if (u) out.push({ url: u, hint: 1024, src: "mask-icon(svg)", authentic: true });
      } else if (/^icon$|shortcut icon/.test(rel)) {
        const u = absolutize(href, base);
        if (u) out.push({ url: u, hint: dim || (/\.svg($|\?)/i.test(href) ? 1024 : 1), src: `rel=icon${dim ? ` ${dim}` : ""}`, authentic: true });
      } else if (/^(og:)?logo$/.test(rel)) {
        const u = absolutize(href, base);
        if (u) out.push({ url: u, hint: 900, src: "rel=logo", authentic: true });
      } else if (/manifest/.test(rel)) {
        const mUrl = absolutize(href, base);
        if (!mUrl) continue;
        try {
          const mr = await politeFetch(mUrl, { timeoutMs: 8000 });
          if (!mr || !mr.ok) continue;
          const mj = await mr.json() as { icons?: Array<{ src?: string; sizes?: string }> };
          for (const ic of mj.icons ?? []) {
            if (!ic.src) continue;
            const u = absolutize(ic.src, mUrl);
            const d = parseInt((ic.sizes ?? "0").split("x")[0], 10) || 0;
            if (u) out.push({ url: u, hint: d, src: `manifest ${ic.sizes ?? "?"}`, authentic: true });
          }
        } catch { /* manifest optional */ }
      }
    }
    if (company) {
      out.push(...markupLogoCandidates(html, base, company));
      out.push(...inlineSvgCandidates(html, company));
    }
    if (out.length) break;
  }

  // Plenty of sites ship these at the conventional path without declaring them.
  for (const [path, hint] of [
    ["/apple-touch-icon.png", 180],
    ["/apple-touch-icon-precomposed.png", 180],
    ["/favicon.svg", 1024],
    ["/logo.svg", 1024],
  ] as const) {
    out.push({ url: `https://${domain}${path}`, hint, src: `conventional ${path}`, authentic: true });
  }

  return out.sort((a, b) => b.hint - a.hint);
}

/**
 * Simple Icons ships hand-drawn SVG marks for a few thousand well-known
 * brands, served in the brand's own color. Only consulted when a company's own
 * site fails to offer anything decent, and only for names that map cleanly to
 * a slug — the CDN 404s on unknown slugs, so a hit is effectively name-exact.
 */
function simpleIconsCandidate(company: string): Candidate | null {
  const slug = company.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug.length < 3 || slug.length > 24) return null;
  // The bare form already serves the mark in the brand's own color.
  return {
    url: `https://cdn.simpleicons.org/${slug}`,
    hint: 800,
    src: "simple-icons",
    authentic: true,
  };
}

/**
 * The posting itself is often the best source: ATS and aggregator job pages
 * display the employer's logo, and for companies with no discoverable site of
 * their own (or one that blocks us) it's the only place it exists.
 */
async function jobPageLogoCandidates(jobUrl: string, company: string): Promise<Candidate[]> {
  const res = await politeFetch(jobUrl, { timeoutMs: 12000, accept: "text/html,*/*" });
  if (!res || !res.ok) return [];
  let html: string;
  try { html = await res.text(); } catch { return []; }

  const base = (() => { try { return new URL(jobUrl).origin; } catch { return jobUrl; } })();
  return [
    ...markupLogoCandidates(html, base, company),
    ...inlineSvgCandidates(html, company),
  ].map((c) => ({ ...c, src: `job-page:${c.src}` }));
}

export type ResolvedLogo = {
  url: string;
  contentType: string;
  ext: string;
  quality: number;
  src: string;
  /**
   * The bytes that were scored. Kept so the caller never has to re-fetch the
   * winner: some hosts answer intermittently, and re-requesting a logo we had
   * already downloaded was discarding good results.
   */
  buf: ArrayBuffer;
};

function extFor(contentType: string, type: string): string {
  if (/svg/i.test(contentType) || type === "svg") return "svg";
  if (type === "jpeg") return "jpg";
  if (type === "ico") return "ico";
  if (type === "webp") return "webp";
  if (type === "gif") return "gif";
  return "png";
}

/**
 * Find the best available logo for a company, preferring vector art, then the
 * largest self-declared asset, and only falling back to favicon services when
 * nothing better exists (rejecting their upscaled output).
 */
export async function resolveBestLogo(
  domain: string | null | undefined,
  provided?: string | null,
  company?: string | null,
  jobUrl?: string | null,
  /** Optional sink for a tier-by-tier account of what was tried. */
  trace?: string[],
): Promise<ResolvedLogo | null> {
  const tiers: Candidate[] = [];
  if (provided) tiers.push({ url: provided, hint: 512, src: "source-provided", authentic: true });

  // Order matters, best-fit first:
  //  1. a large icon the company declares about itself — square, and keeps
  //     multi-colour artwork, so it suits the card's square well
  //  2. the Simple Icons vector — always crisp, brand-coloured
  //  3. a logo lifted from page markup — usually the real wordmark, and the
  //     only decent asset on sites that ship nothing but a 32px favicon
  //  4. small declared icons, then favicon services as a last resort
  const siteIcons = domain ? await siteIconCandidates(domain, company) : [];
  const markup = siteIcons.filter((c) => c.src === "markup-logo" || c.src.startsWith("inline-svg"));
  const declared = siteIcons.filter((c) => !(c.src === "markup-logo" || c.src.startsWith("inline-svg")));
  const strong = declared.filter((c) => c.hint >= 192);
  const weak = declared.filter((c) => c.hint < 192);

  tiers.push(...strong.slice(0, 5));
  if (company) {
    const si = simpleIconsCandidate(company);
    if (si) tiers.push(si);
  }
  tiers.push(...markup.slice(0, 4));
  // The posting page — the only source for employers with no site of their own.
  if (jobUrl && company) {
    const jp = await jobPageLogoCandidates(jobUrl, company);
    trace?.push(`· job-page yielded ${jp.length} candidate(s) from ${jobUrl.slice(0, 90)}`);
    tiers.push(...jp.slice(0, 4));
  }
  tiers.push(...weak.slice(0, 4));
  if (domain) {
    tiers.push({ url: `https://unavatar.io/${domain}?fallback=false`, hint: 256, src: "unavatar", authentic: false });
    tiers.push({ url: `https://icons.duckduckgo.com/ip3/${domain}.ico`, hint: 64, src: "duckduckgo", authentic: false });
    tiers.push({ url: `https://www.google.com/s2/favicons?domain=${domain}&sz=256`, hint: 32, src: "google-favicon", authentic: false });
  }

  let best: ResolvedLogo | null = null;
  for (const t of tiers) {
    const got = await fetchImage(t.url);
    if (!got) { trace?.push(`✗ ${t.src}: unreachable/not-an-image — ${t.url.slice(0, 110)}`); continue; }
    const s = scoreImage(got.buf, t.authentic);
    if (!s.ok) { trace?.push(`✗ ${t.src}: ${s.why} — ${t.url.slice(0, 110)}`); continue; }
    trace?.push(`✓ ${t.src}: ${s.why} [${s.meta.type}] q=${s.quality} — ${t.url.slice(0, 110)}`);
    if (!best || s.quality > best.quality) {
      best = {
        url: t.url,
        contentType: got.contentType.split(";")[0] || "image/png",
        ext: extFor(got.contentType, s.meta.type),
        quality: s.quality,
        src: `${t.src} (${s.why})`,
        buf: got.buf,
      };
    }
    if (best.quality >= 512) break; // vector or a large authentic asset — done
  }
  return best;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "") || null;
  } catch { return null; }
}

/**
 * Last-resort domain lookup for rows that never recorded a companyUrl.
 * Guesses "<name>.com" but only accepts it if the site identifies itself with
 * the company name, so we never staple a stranger's logo onto a listing.
 */
export async function guessDomain(company: string): Promise<string | null> {
  const word = company.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!word || word.length < 3) return null;
  const compact = company.toLowerCase().replace(/[^a-z0-9]/g, "");

  // When the company name already states its domain ("Lemon.io", "brand.ai"),
  // trust it and stop. Verification is skipped deliberately: sites behind bot
  // protection refuse datacenter IPs, and falling through would then invent
  // lemonio.com — a *different* company that passes the name check just as
  // convincingly. An unverified correct domain beats a verified wrong one.
  const embedded = /\b([a-z0-9][a-z0-9-]*\.[a-z]{2,})\b/i.exec(company)?.[1]?.toLowerCase();
  if (embedded) return embedded;

  for (const domain of [`${compact}.com`, `${word}.com`]) {
    try {
      const res = await politeFetch(`https://${domain}`, { timeoutMs: 8000, accept: "text/html,*/*" });
      if (!res || !res.ok) continue;
      const html = (await res.text()).slice(0, 20000);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
      const siteName = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? "";
      const haystack = `${title} ${siteName}`.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (haystack.includes(word)) return domain;
    } catch { /* try the next shape */ }
  }
  return null;
}

/**
 * Authoritative domain for a company we already track in SOURCES.
 * Built lazily because SOURCES is declared further down this module.
 */
let sourceDomains: Map<string, { domain: string; url: string }> | null = null;

export function knownCompanySite(company: string): { domain: string; url: string } | null {
  if (!sourceDomains) {
    sourceDomains = new Map(
      SOURCES.map((s) => [s.name.trim().toLowerCase(), { domain: s.domain, url: s.url }]),
    );
  }
  return sourceDomains.get(company.trim().toLowerCase()) ?? null;
}

// ── Sources ───────────────────────────────────────────────────────────────

export interface Source {
  ats: "greenhouse" | "lever" | "ashby";
  slug: string;
  name: string;
  domain: string;
  url: string;
}

export const SOURCES: Source[] = [
  { ats: "greenhouse", slug: "figma",          name: "Figma",         domain: "figma.com",        url: "https://figma.com" },
  { ats: "greenhouse", slug: "notion",         name: "Notion",        domain: "notion.so",        url: "https://notion.so" },
  { ats: "greenhouse", slug: "stripe",         name: "Stripe",        domain: "stripe.com",       url: "https://stripe.com" },
  { ats: "greenhouse", slug: "airtable",       name: "Airtable",      domain: "airtable.com",     url: "https://airtable.com" },
  { ats: "greenhouse", slug: "dropbox",        name: "Dropbox",       domain: "dropbox.com",      url: "https://dropbox.com" },
  { ats: "greenhouse", slug: "brex",           name: "Brex",          domain: "brex.com",         url: "https://brex.com" },
  { ats: "greenhouse", slug: "opentable",      name: "OpenTable",     domain: "opentable.com",    url: "https://www.opentable.com" },
  { ats: "greenhouse", slug: "mercurytech",    name: "Mercury",       domain: "mercury.com",      url: "https://mercury.com" },
  { ats: "greenhouse", slug: "benchling",      name: "Benchling",     domain: "benchling.com",    url: "https://benchling.com" },
  { ats: "greenhouse", slug: "anduril",        name: "Anduril",       domain: "anduril.com",      url: "https://anduril.com" },
  { ats: "greenhouse", slug: "rippling",       name: "Rippling",      domain: "rippling.com",     url: "https://rippling.com" },
  { ats: "greenhouse", slug: "lattice",        name: "Lattice",       domain: "lattice.com",      url: "https://lattice.com" },
  { ats: "greenhouse", slug: "gusto",          name: "Gusto",         domain: "gusto.com",        url: "https://gusto.com" },
  { ats: "greenhouse", slug: "intercom",       name: "Intercom",      domain: "intercom.com",     url: "https://intercom.com" },
  { ats: "greenhouse", slug: "superhuman",     name: "Superhuman",    domain: "superhuman.com",   url: "https://superhuman.com" },
  { ats: "greenhouse", slug: "coinbase",       name: "Coinbase",      domain: "coinbase.com",     url: "https://coinbase.com" },
  { ats: "greenhouse", slug: "klaviyo",        name: "Klaviyo",       domain: "klaviyo.com",      url: "https://klaviyo.com" },
  { ats: "greenhouse", slug: "webflow",        name: "Webflow",       domain: "webflow.com",      url: "https://webflow.com" },
  { ats: "greenhouse", slug: "miro",           name: "Miro",          domain: "miro.com",         url: "https://miro.com" },
  { ats: "greenhouse", slug: "canva",          name: "Canva",         domain: "canva.com",        url: "https://canva.com" },
  { ats: "greenhouse", slug: "productboard",   name: "Productboard",  domain: "productboard.com", url: "https://productboard.com" },
  { ats: "greenhouse", slug: "asana",          name: "Asana",         domain: "asana.com",        url: "https://asana.com" },
  { ats: "greenhouse", slug: "duolingo",       name: "Duolingo",      domain: "duolingo.com",     url: "https://duolingo.com" },
  { ats: "greenhouse", slug: "robinhood",      name: "Robinhood",     domain: "robinhood.com",    url: "https://robinhood.com" },
  { ats: "greenhouse", slug: "loom",           name: "Loom",          domain: "loom.com",         url: "https://loom.com" },
  { ats: "greenhouse", slug: "zendesk",        name: "Zendesk",       domain: "zendesk.com",      url: "https://zendesk.com" },
  { ats: "greenhouse", slug: "hubspot",        name: "HubSpot",       domain: "hubspot.com",      url: "https://hubspot.com" },
  { ats: "greenhouse", slug: "gitlab",         name: "GitLab",        domain: "gitlab.com",       url: "https://gitlab.com" },
  { ats: "greenhouse", slug: "twilio",         name: "Twilio",        domain: "twilio.com",       url: "https://twilio.com" },
  { ats: "greenhouse", slug: "verkada",        name: "Verkada",       domain: "verkada.com",      url: "https://verkada.com" },
  { ats: "greenhouse", slug: "carta",          name: "Carta",         domain: "carta.com",        url: "https://carta.com" },
  { ats: "greenhouse", slug: "vantacom",       name: "Vanta",         domain: "vanta.com",        url: "https://vanta.com" },
  { ats: "greenhouse", slug: "openai",         name: "OpenAI",        domain: "openai.com",       url: "https://openai.com" },
  { ats: "greenhouse", slug: "anthropic",      name: "Anthropic",     domain: "anthropic.com",    url: "https://anthropic.com" },
  { ats: "greenhouse", slug: "cohere",         name: "Cohere",        domain: "cohere.com",       url: "https://cohere.com" },
  { ats: "greenhouse", slug: "scale",          name: "Scale AI",      domain: "scale.com",        url: "https://scale.com" },
  { ats: "greenhouse", slug: "nianticlabs",    name: "Niantic",       domain: "nianticlabs.com",  url: "https://nianticlabs.com" },
  { ats: "greenhouse", slug: "headspace",      name: "Headspace",     domain: "headspace.com",    url: "https://headspace.com" },
  { ats: "greenhouse", slug: "calm",           name: "Calm",          domain: "calm.com",         url: "https://calm.com" },
  { ats: "greenhouse", slug: "stytch",         name: "Stytch",        domain: "stytch.com",       url: "https://stytch.com" },
  { ats: "greenhouse", slug: "vercel",         name: "Vercel",        domain: "vercel.com",       url: "https://vercel.com" },
  { ats: "greenhouse", slug: "runway",         name: "Runway",        domain: "runwayml.com",     url: "https://runwayml.com" },
  { ats: "greenhouse", slug: "midjourney",     name: "Midjourney",    domain: "midjourney.com",   url: "https://midjourney.com" },
  // Added after probing candidate boards for live design roles (see
  // scripts/probe-job-boards.mjs) — each of these had at least one when added.
  { ats: "greenhouse", slug: "datadog",        name: "Datadog",       domain: "datadoghq.com",    url: "https://datadoghq.com" },
  { ats: "greenhouse", slug: "affirm",         name: "Affirm",        domain: "affirm.com",       url: "https://affirm.com" },
  { ats: "greenhouse", slug: "instacart",      name: "Instacart",     domain: "instacart.com",    url: "https://instacart.com" },
  { ats: "greenhouse", slug: "peloton",        name: "Peloton",       domain: "onepeloton.com",   url: "https://onepeloton.com" },
  { ats: "greenhouse", slug: "discord",        name: "Discord",       domain: "discord.com",      url: "https://discord.com" },
  { ats: "greenhouse", slug: "pinterest",      name: "Pinterest",     domain: "pinterest.com",    url: "https://pinterest.com" },
  { ats: "greenhouse", slug: "chime",          name: "Chime",         domain: "chime.com",        url: "https://chime.com" },
  { ats: "greenhouse", slug: "databricks",     name: "Databricks",    domain: "databricks.com",   url: "https://databricks.com" },
  { ats: "greenhouse", slug: "coursera",       name: "Coursera",      domain: "coursera.org",     url: "https://coursera.org" },
  { ats: "greenhouse", slug: "airbnb",         name: "Airbnb",        domain: "airbnb.com",       url: "https://airbnb.com" },
  { ats: "greenhouse", slug: "faire",          name: "Faire",         domain: "faire.com",        url: "https://faire.com" },
  { ats: "greenhouse", slug: "amplitude",      name: "Amplitude",     domain: "amplitude.com",    url: "https://amplitude.com" },
  // Added by probing larger orgs specifically for design leadership openings,
  // which are only ~8% of listings and so need targeting rather than luck.
  { ats: "greenhouse", slug: "epicgames",      name: "Epic Games",    domain: "epicgames.com",    url: "https://epicgames.com" },
  { ats: "greenhouse", slug: "riotgames",      name: "Riot Games",    domain: "riotgames.com",    url: "https://riotgames.com" },
  { ats: "greenhouse", slug: "roblox",         name: "Roblox",        domain: "roblox.com",       url: "https://roblox.com" },
  { ats: "greenhouse", slug: "okta",           name: "Okta",          domain: "okta.com",         url: "https://okta.com" },
  { ats: "greenhouse", slug: "zocdoc",         name: "Zocdoc",        domain: "zocdoc.com",       url: "https://zocdoc.com" },
  { ats: "greenhouse", slug: "block",          name: "Block",         domain: "block.xyz",        url: "https://block.xyz" },
  { ats: "greenhouse", slug: "sofi",           name: "SoFi",          domain: "sofi.com",         url: "https://sofi.com" },
  { ats: "greenhouse", slug: "justworks",      name: "Justworks",     domain: "justworks.com",    url: "https://justworks.com" },
  { ats: "greenhouse", slug: "cloudflare",     name: "Cloudflare",    domain: "cloudflare.com",   url: "https://cloudflare.com" },
  { ats: "greenhouse", slug: "udemy",          name: "Udemy",         domain: "udemy.com",        url: "https://udemy.com" },
  { ats: "greenhouse", slug: "remotecom",      name: "Remote",        domain: "remote.com",       url: "https://remote.com" },
  { ats: "greenhouse", slug: "carvana",        name: "Carvana",       domain: "carvana.com",      url: "https://carvana.com" },
  { ats: "greenhouse", slug: "oura",           name: "Oura",          domain: "ouraring.com",     url: "https://ouraring.com" },
  { ats: "greenhouse", slug: "samsara",        name: "Samsara",       domain: "samsara.com",      url: "https://samsara.com" },
  { ats: "greenhouse", slug: "waymo",          name: "Waymo",         domain: "waymo.com",        url: "https://waymo.com" },
  { ats: "greenhouse", slug: "fivetran",       name: "Fivetran",      domain: "fivetran.com",     url: "https://fivetran.com" },
  { ats: "greenhouse", slug: "gemini",         name: "Gemini",        domain: "gemini.com",       url: "https://gemini.com" },
  { ats: "greenhouse", slug: "adyen",          name: "Adyen",         domain: "adyen.com",        url: "https://adyen.com" },
  { ats: "greenhouse", slug: "iterable",       name: "Iterable",      domain: "iterable.com",     url: "https://iterable.com" },
  { ats: "greenhouse", slug: "sigmacomputing", name: "Sigma",         domain: "sigmacomputing.com", url: "https://sigmacomputing.com" },
  { ats: "greenhouse", slug: "mixpanel",       name: "Mixpanel",      domain: "mixpanel.com",     url: "https://mixpanel.com" },
  // Employers surfaced by designleaderjobs.com's board that we didn't yet cover.
  // Only those on Greenhouse/Lever/Ashby; their Workday-based employers
  // (Amazon, Adobe, Capital One, Mastercard, NVIDIA) need a separate fetcher.
  { ats: "greenhouse", slug: "babylist",       name: "Babylist",      domain: "babylist.com",     url: "https://babylist.com" },
  { ats: "greenhouse", slug: "ethoslife",      name: "Ethos",         domain: "ethoslife.com",    url: "https://ethoslife.com" },
  { ats: "greenhouse", slug: "newrelic",       name: "New Relic",     domain: "newrelic.com",     url: "https://newrelic.com" },
  { ats: "greenhouse", slug: "monzo",          name: "Monzo",         domain: "monzo.com",        url: "https://monzo.com" },
  // Added 2026-09-23 after probing new design-forward candidates for live
  // design roles (scripts/probe-job-boards.mjs), cross-checked against the
  // full isDesignRole()/isLeadershipRole() above rather than the script's
  // reduced copy.
  { ats: "greenhouse", slug: "mavenclinic",    name: "Maven Clinic",  domain: "mavenclinic.com", url: "https://mavenclinic.com" },
  { ats: "greenhouse", slug: "hightouch",      name: "Hightouch",     domain: "hightouch.com",   url: "https://hightouch.com" },
  { ats: "greenhouse", slug: "gleanwork",      name: "Glean",         domain: "glean.com",       url: "https://glean.com" },
  { ats: "greenhouse", slug: "current",        name: "Current",       domain: "current.com",     url: "https://current.com" },
  { ats: "greenhouse", slug: "step",           name: "Step",          domain: "step.com",        url: "https://step.com" },
  { ats: "lever", slug: "netflix",       name: "Netflix",      domain: "netflix.com",      url: "https://netflix.com" },
  { ats: "lever", slug: "squareup",      name: "Square",       domain: "squareup.com",     url: "https://squareup.com" },
  { ats: "lever", slug: "shopify",       name: "Shopify",      domain: "shopify.com",      url: "https://shopify.com" },
  { ats: "lever", slug: "mongodb",       name: "MongoDB",      domain: "mongodb.com",      url: "https://mongodb.com" },
  { ats: "lever", slug: "elastic",       name: "Elastic",      domain: "elastic.co",       url: "https://elastic.co" },
  { ats: "lever", slug: "atlassian",     name: "Atlassian",    domain: "atlassian.com",    url: "https://atlassian.com" },
  { ats: "lever", slug: "hashicorp",     name: "HashiCorp",    domain: "hashicorp.com",    url: "https://hashicorp.com" },
  { ats: "lever", slug: "reddit",        name: "Reddit",       domain: "reddit.com",       url: "https://reddit.com" },
  { ats: "lever", slug: "lyft",          name: "Lyft",         domain: "lyft.com",         url: "https://lyft.com" },
  { ats: "lever", slug: "eventbrite",    name: "Eventbrite",   domain: "eventbrite.com",   url: "https://eventbrite.com" },
  { ats: "lever", slug: "github",        name: "GitHub",       domain: "github.com",       url: "https://github.com" },
  { ats: "lever", slug: "squarespace",   name: "Squarespace",  domain: "squarespace.com",  url: "https://squarespace.com" },
  { ats: "lever", slug: "invisionapp",   name: "InVision",     domain: "invisionapp.com",  url: "https://invisionapp.com" },
  { ats: "lever", slug: "wealthsimple",  name: "Wealthsimple", domain: "wealthsimple.com", url: "https://wealthsimple.com" },
  { ats: "lever", slug: "linear",        name: "Linear",       domain: "linear.app",       url: "https://linear.app" },
  { ats: "lever", slug: "retool",        name: "Retool",       domain: "retool.com",       url: "https://retool.com" },
  { ats: "lever", slug: "ramp",          name: "Ramp",         domain: "ramp.com",         url: "https://ramp.com" },
  { ats: "lever", slug: "descript",      name: "Descript",     domain: "descript.com",     url: "https://descript.com" },
  { ats: "lever", slug: "perplexity",    name: "Perplexity",   domain: "perplexity.ai",    url: "https://perplexity.ai" },
  { ats: "lever", slug: "cursor",        name: "Cursor",       domain: "cursor.com",       url: "https://cursor.com" },
  { ats: "lever", slug: "pointclickcare", name: "PointClickCare", domain: "pointclickcare.com", url: "https://pointclickcare.com" },
  { ats: "lever", slug: "spotify",       name: "Spotify",      domain: "spotify.com",      url: "https://spotify.com" },
  { ats: "lever", slug: "palantir",      name: "Palantir",     domain: "palantir.com",     url: "https://palantir.com" },
  { ats: "lever", slug: "wealthfront",   name: "Wealthfront",  domain: "wealthfront.com",  url: "https://wealthfront.com" },
  { ats: "lever", slug: "gohighlevel",   name: "HighLevel",    domain: "gohighlevel.com",  url: "https://gohighlevel.com" },
  { ats: "lever", slug: "coins",         name: "Coins.ph",     domain: "coins.ph",         url: "https://coins.ph" },
  { ats: "lever", slug: "luxurypresence", name: "Luxury Presence", domain: "luxurypresence.com", url: "https://luxurypresence.com" },
  { ats: "ashby", slug: "lumaai",        name: "Luma AI",      domain: "lumalabs.ai",      url: "https://lumalabs.ai" },
  { ats: "ashby", slug: "arc-browser",   name: "Arc Browser",  domain: "arc.net",          url: "https://arc.net" },
  { ats: "ashby", slug: "elevenlabs",    name: "ElevenLabs",   domain: "elevenlabs.io",    url: "https://elevenlabs.io" },
  { ats: "ashby", slug: "togetherai",    name: "Together AI",  domain: "together.ai",      url: "https://together.ai" },
  { ats: "ashby", slug: "anyscale",      name: "Anyscale",     domain: "anyscale.com",     url: "https://anyscale.com" },
  { ats: "ashby", slug: "photoroom",     name: "PhotoRoom",    domain: "photoroom.com",    url: "https://photoroom.com" },
  { ats: "ashby", slug: "supabase",      name: "Supabase",     domain: "supabase.com",     url: "https://supabase.com" },
  { ats: "ashby", slug: "posthog",       name: "PostHog",      domain: "posthog.com",      url: "https://posthog.com" },
  { ats: "ashby", slug: "raycast",       name: "Raycast",      domain: "raycast.com",      url: "https://raycast.com" },
  { ats: "ashby", slug: "framer",        name: "Framer",       domain: "framer.com",       url: "https://framer.com" },
  { ats: "ashby", slug: "clerk",         name: "Clerk",        domain: "clerk.com",        url: "https://clerk.com" },
  { ats: "ashby", slug: "ambiencehealthcare", name: "Ambience Healthcare", domain: "ambiencehealthcare.com", url: "https://ambiencehealthcare.com" },
  { ats: "ashby", slug: "hingehealth",   name: "Hinge Health", domain: "hingehealth.com",  url: "https://hingehealth.com" },
  { ats: "ashby", slug: "whoop",         name: "WHOOP",        domain: "whoop.com",        url: "https://whoop.com" },
  { ats: "ashby", slug: "eightsleep",    name: "Eight Sleep",  domain: "eightsleep.com",   url: "https://eightsleep.com" },
  { ats: "ashby", slug: "snowflake",     name: "Snowflake",    domain: "snowflake.com",    url: "https://snowflake.com" },
  { ats: "ashby", slug: "render",        name: "Render",       domain: "render.com",       url: "https://render.com" },
  { ats: "ashby", slug: "strava",        name: "Strava",       domain: "strava.com",       url: "https://strava.com" },
  { ats: "ashby", slug: "replit",        name: "Replit",       domain: "replit.com",       url: "https://replit.com" },
  { ats: "ashby", slug: "plaid",         name: "Plaid",        domain: "plaid.com",        url: "https://plaid.com" },
  { ats: "ashby", slug: "patreon",       name: "Patreon",      domain: "patreon.com",      url: "https://patreon.com" },
  { ats: "ashby", slug: "nubank",        name: "Nubank",       domain: "nubank.com.br",    url: "https://nubank.com.br" },
  { ats: "ashby", slug: "headway",       name: "Headway",      domain: "headway.co",       url: "https://headway.co" },
  { ats: "ashby", slug: "clickup",       name: "ClickUp",      domain: "clickup.com",      url: "https://clickup.com" },
  { ats: "ashby", slug: "mural",         name: "Mural",        domain: "mural.co",         url: "https://mural.co" },
  { ats: "ashby", slug: "gamma",         name: "Gamma",        domain: "gamma.app",        url: "https://gamma.app" },
  { ats: "ashby", slug: "nerdwallet",    name: "NerdWallet",   domain: "nerdwallet.com",   url: "https://nerdwallet.com" },
  { ats: "ashby", slug: "acorns",        name: "Acorns",       domain: "acorns.com",       url: "https://acorns.com" },
  { ats: "ashby", slug: "alchemy",       name: "Alchemy",      domain: "alchemy.com",      url: "https://alchemy.com" },
  { ats: "ashby", slug: "hex",           name: "Hex",          domain: "hex.tech",         url: "https://hex.tech" },
  { ats: "ashby", slug: "uniswap",       name: "Uniswap",      domain: "uniswap.org",      url: "https://uniswap.org" },
  { ats: "ashby", slug: "harvey",        name: "Harvey",       domain: "harvey.ai",        url: "https://harvey.ai" },
  { ats: "ashby", slug: "abridge",       name: "Abridge",      domain: "abridge.com",      url: "https://abridge.com" },
  { ats: "ashby", slug: "givebutter",    name: "Givebutter",   domain: "givebutter.com",   url: "https://givebutter.com" },
  // Added 2026-09-23 — see comment above the Greenhouse additions in this same wave.
  { ats: "ashby", slug: "sierra",        name: "Sierra",       domain: "sierra.ai",        url: "https://sierra.ai" },
  { ats: "ashby", slug: "baseten",       name: "Baseten",      domain: "baseten.co",       url: "https://baseten.co" },
  { ats: "ashby", slug: "decagon",       name: "Decagon",      domain: "decagon.ai",       url: "https://decagon.ai" },
  { ats: "ashby", slug: "workos",        name: "WorkOS",       domain: "workos.com",       url: "https://workos.com" },
  { ats: "ashby", slug: "zapier",        name: "Zapier",       domain: "zapier.com",       url: "https://zapier.com" },
  { ats: "ashby", slug: "lovable",       name: "Lovable",      domain: "lovable.dev",      url: "https://lovable.dev" },
  { ats: "ashby", slug: "rho",           name: "Rho",          domain: "rho.co",           url: "https://rho.co" },
  { ats: "ashby", slug: "n8n",           name: "n8n",          domain: "n8n.io",           url: "https://n8n.io" },
  { ats: "ashby", slug: "secureframe",   name: "Secureframe",  domain: "secureframe.com",  url: "https://secureframe.com" },
  { ats: "ashby", slug: "bumbleinc",     name: "Bumble",       domain: "bumble.com",       url: "https://bumble.com" },
  { ats: "ashby", slug: "fal-ai",        name: "fal",          domain: "fal.ai",           url: "https://fal.ai" },
  { ats: "ashby", slug: "resend",        name: "Resend",       domain: "resend.com",       url: "https://resend.com" },
  { ats: "ashby", slug: "watershed",     name: "Watershed",    domain: "watershed.com",    url: "https://watershed.com" },
  { ats: "ashby", slug: "highbeam",      name: "Highbeam",     domain: "highbeam.com",     url: "https://highbeam.com" },
  { ats: "ashby", slug: "speak",         name: "Speak",        domain: "speak.com",        url: "https://speak.com" },
];

// ── Candidate shape ──────────────────────────────────────────────────────

export interface CandidateJob {
  title: string;
  company: string;
  companyUrl: string | null;
  companyDomain: string | null;
  jobUrl: string;
  location: string;
  remote: boolean;
  description: string | null;
  compensation: string | null;
  typeOfRole: string;
  /** Logo the source itself supplied, if any (already real artwork). */
  logoHint: string | null;
  origin: string;
}

const REMOTE_RX = /\bremote\b|\banywhere\b|\bdistributed\b/i;

// ── Fetchers ─────────────────────────────────────────────────────────────

export async function fetchGreenhouse(src: Source): Promise<CandidateJob[]> {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${src.slug}/jobs?content=true`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      jobs: Array<{
        title: string; absolute_url: string; content?: string;
        location?: { name?: string };
        pay_input_ranges?: Array<{ min_cents?: number; max_cents?: number; currency_type?: string }>;
      }>;
    };
    return (data.jobs ?? []).filter((j) => isDesignRole(j.title)).map((j) => {
      const description = htmlToText(j.content);
      const location = j.location?.name ?? "";
      const range = j.pay_input_ranges?.[0];
      const compensation = range && (range.min_cents || range.max_cents)
        ? formatSalaryRange({
            min: range.min_cents ? range.min_cents / 100 : null,
            max: range.max_cents ? range.max_cents / 100 : null,
            currency: range.currency_type ?? "USD",
            interval: "year",
          })
        : extractCompensation(description);
      return {
        title: j.title, company: src.name, companyUrl: src.url, companyDomain: src.domain,
        jobUrl: j.absolute_url, location, remote: REMOTE_RX.test(location),
        description, compensation,
        typeOfRole: mapTypeOfRole(null, j.title), logoHint: null, origin: `greenhouse:${src.slug}`,
      };
    });
  } catch { return []; }
}

export async function fetchLever(src: Source): Promise<CandidateJob[]> {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${src.slug}?mode=json`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json() as Array<{
      text: string; hostedUrl: string; descriptionPlain?: string; description?: string;
      categories?: { location?: string; commitment?: string };
      workplaceType?: string;
      salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
      salaryDescriptionPlain?: string;
    }>;
    if (!Array.isArray(data)) return [];
    return data.filter((j) => isDesignRole(j.text)).map((j) => {
      const description = j.descriptionPlain?.trim() || htmlToText(j.description);
      const location = j.categories?.location ?? j.workplaceType ?? "";
      return {
        title: j.text, company: src.name, companyUrl: src.url, companyDomain: src.domain,
        jobUrl: j.hostedUrl, location,
        remote: REMOTE_RX.test(`${location} ${j.workplaceType ?? ""}`),
        description,
        compensation: formatSalaryRange(j.salaryRange) ?? extractCompensation(j.salaryDescriptionPlain ?? description),
        typeOfRole: mapTypeOfRole(j.categories?.commitment, j.text),
        logoHint: null, origin: `lever:${src.slug}`,
      };
    });
  } catch { return []; }
}

export async function fetchAshby(src: Source): Promise<CandidateJob[]> {
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${src.slug}?includeCompensation=true`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      jobs?: Array<{
        title: string; jobUrl?: string; applyUrl?: string; location?: string;
        isListed?: boolean; isRemote?: boolean; employmentType?: string;
        descriptionPlain?: string; descriptionHtml?: string;
        compensation?: {
          scrapeableCompensationSalarySummary?: string | null;
          compensationTierSummary?: string | null;
        };
      }>;
    };
    return (data.jobs ?? [])
      .filter((j) => j.isListed !== false && isDesignRole(j.title))
      .map((j) => {
        const description = j.descriptionPlain?.trim() || htmlToText(j.descriptionHtml);
        const location = j.location ?? "";
        const summary = j.compensation?.compensationTierSummary
          ?? j.compensation?.scrapeableCompensationSalarySummary
          ?? null;
        return {
          title: j.title, company: src.name, companyUrl: src.url, companyDomain: src.domain,
          jobUrl: j.jobUrl ?? j.applyUrl ?? "", location,
          remote: Boolean(j.isRemote) || REMOTE_RX.test(location),
          description,
          compensation: summary?.trim() || extractCompensation(description),
          typeOfRole: mapTypeOfRole(j.employmentType, j.title),
          logoHint: null, origin: `ashby:${src.slug}`,
        };
      })
      .filter((j) => j.jobUrl);
  } catch { return []; }
}

export async function fetchRemotive(): Promise<CandidateJob[]> {
  try {
    const res = await fetch("https://remotive.com/api/remote-jobs?category=Design&limit=100", {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      jobs?: Array<{
        title: string; company_name: string; url: string; description?: string;
        candidate_required_location?: string; salary?: string; job_type?: string;
        company_logo_url?: string; company_logo?: string;
      }>;
    };
    return (data.jobs ?? []).filter((j) => isDesignRole(j.title)).map((j) => {
      const description = htmlToText(j.description);
      return {
        title: j.title, company: j.company_name, companyUrl: null, companyDomain: null,
        jobUrl: j.url, location: j.candidate_required_location ?? "Remote", remote: true,
        description,
        compensation: (j.salary?.trim() || null) ?? extractCompensation(description),
        typeOfRole: mapTypeOfRole(j.job_type, j.title),
        logoHint: j.company_logo_url ?? j.company_logo ?? null,
        origin: "remotive",
      };
    });
  } catch { return []; }
}

export async function fetchRemoteOK(): Promise<CandidateJob[]> {
  try {
    const res = await fetch("https://remoteok.com/api?tags=design", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json() as Array<{
      position?: string; company?: string; apply_url?: string; url?: string;
      location?: string; description?: string; logo?: string; company_logo?: string;
      salary_min?: number; salary_max?: number;
    }>;
    if (!Array.isArray(data)) return [];
    return data
      .filter((j) => j?.position && isDesignRole(j.position))
      .map((j) => {
        const description = htmlToText(j.description);
        return {
          title: j.position!, company: j.company ?? "", companyUrl: null, companyDomain: null,
          jobUrl: j.apply_url || j.url || "", location: j.location ?? "Remote", remote: true,
          description,
          compensation: formatSalaryRange({
            min: j.salary_min, max: j.salary_max, currency: "USD", interval: "year",
          }) ?? extractCompensation(description),
          typeOfRole: mapTypeOfRole(null, j.position!),
          logoHint: j.logo ?? j.company_logo ?? null,
          origin: "remoteok",
        };
      })
      .filter((j) => j.jobUrl && j.company);
  } catch { return []; }
}

export async function fetchWeWorkRemotely(): Promise<CandidateJob[]> {
  try {
    const res = await fetch("https://weworkremotely.com/categories/remote-design-jobs.rss", {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: CandidateJob[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const raw = m[1];
      const pick = (tag: string) =>
        new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(raw)?.[1]?.trim() ?? "";
      const rawTitle = decodeEntities(pick("title"));
      const link = pick("link");
      if (!rawTitle || !link) continue;
      // WWR encodes titles as "Company: Job Title"
      const idx = rawTitle.indexOf(": ");
      const company = idx > 0 ? rawTitle.slice(0, idx).trim() : "";
      const title = idx > 0 ? rawTitle.slice(idx + 2).trim() : rawTitle;
      if (!company || !isDesignRole(title)) continue;

      const descriptionRaw = pick("description");
      const description = htmlToText(descriptionRaw);
      const region = decodeEntities(pick("region")) || "Remote";
      const logoHint = /<media:content[^>]*url="([^"]+)"/.exec(raw)?.[1] ?? null;
      // WWR descriptions frequently carry the company's own site link.
      const siteUrl = /(?:Website|URL|Homepage)\s*:?\s*(https?:\/\/[^\s<"']+)/i.exec(description ?? "")?.[1] ?? null;

      out.push({
        title, company, companyUrl: siteUrl, companyDomain: domainOf(siteUrl),
        jobUrl: link, location: region, remote: true,
        description,
        compensation: extractCompensation(description),
        typeOfRole: mapTypeOfRole(pick("type"), title),
        logoHint, origin: "weworkremotely",
      });
    }
    return out;
  } catch { return []; }
}

// ── Workday ──────────────────────────────────────────────────────────────
// Most of the Fortune 500 hires through Workday, and none of it is reachable via
// Greenhouse/Lever/Ashby. Each tenant's careers page is backed by a public JSON
// endpoint (the same one the page itself calls), so no scraping is involved.

export interface WorkdaySource {
  ats: "workday";
  tenant: string;  // "adobe"
  host: string;    // "wd5"
  site: string;    // "external_experienced"
  name: string;
  domain: string;
  url: string;
  /** Extra per-tenant title exclusions, e.g. hardware-heavy employers. */
  exclude?: RegExp[];
}

export const WORKDAY_SOURCES: WorkdaySource[] = [
  { ats: "workday", tenant: "adobe",      host: "wd5",  site: "external_experienced",        name: "Adobe",       domain: "adobe.com",       url: "https://adobe.com" },
  { ats: "workday", tenant: "capitalone", host: "wd12", site: "Capital_One",                 name: "Capital One", domain: "capitalone.com",  url: "https://capitalone.com" },
  { ats: "workday", tenant: "mastercard", host: "wd1",  site: "CorporateCareers",            name: "Mastercard",  domain: "mastercard.com",  url: "https://mastercard.com" },
  { ats: "workday", tenant: "salesforce", host: "wd12", site: "External_Career_Site",        name: "Salesforce",  domain: "salesforce.com",  url: "https://salesforce.com" },
  { ats: "workday", tenant: "autodesk",   host: "wd1",  site: "Ext",                         name: "Autodesk",    domain: "autodesk.com",    url: "https://autodesk.com" },
  { ats: "workday", tenant: "ebay",       host: "wd5",  site: "apply",                       name: "eBay",        domain: "ebay.com",        url: "https://ebay.com" },
  // Target's design org is mostly apparel and home goods, named after product lines.
  { ats: "workday", tenant: "target",     host: "wd5",  site: "targetcareers",               name: "Target",      domain: "target.com",      url: "https://target.com",
    exclude: [/sweater|sleepwear|swim|denim|intimate|accessor|softlines|hardlines|home\s+d[eé]cor|owned\s+brands?|\b(kids|girls|boys|toddler|baby|men'?s|women'?s|infant)\b/i] },
  { ats: "workday", tenant: "disney",     host: "wd5",  site: "disneycareer",                name: "Disney",      domain: "disney.com",      url: "https://disney.com" },
  { ats: "workday", tenant: "workday",    host: "wd5",  site: "Workday",                     name: "Workday",     domain: "workday.com",     url: "https://workday.com" },
  { ats: "workday", tenant: "cvshealth",  host: "wd1",  site: "cvs_health_careers",          name: "CVS Health",  domain: "cvshealth.com",   url: "https://cvshealth.com" },
  // ~2,000 postings, overwhelmingly chip design; "design engineer" there is hardware.
  { ats: "workday", tenant: "nvidia",     host: "wd5",  site: "NVIDIAExternalCareerSite",    name: "NVIDIA",      domain: "nvidia.com",      url: "https://nvidia.com",
    exclude: [/\bhardware\b/i, /\bdesign engineer\b/i, /\bsystems?\b/i, /\bchip\b/i, /co-design/i] },
];

/**
 * Workday's search is fuzzy and returns everything containing the token, so a
 * handful of targeted queries plus our own title filter beats one broad one.
 * Leadership titles rarely contain "designer", hence the extra terms.
 */
const WORKDAY_QUERIES = ["designer", "design", "ux", "user experience", "creative director", "art director"];
/** Pages of 20 per query. Relevance-ranked, so real roles surface early. */
const WORKDAY_MAX_PER_QUERY = 120;

async function workdayPost(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok ? await res.json() as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * @param knownUrls  apply URLs already on the board. The daily ingest passes
 *   these so detail requests are only made for genuinely new roles; the backfill
 *   omits it to get full records for matching.
 */
export async function fetchWorkday(src: WorkdaySource, knownUrls?: Set<string>): Promise<CandidateJob[]> {
  const base = `https://${src.tenant}.${src.host}.myworkdayjobs.com`;
  const api = `${base}/wday/cxs/${src.tenant}/${src.site}`;

  // Union the search results by externalPath.
  const found = new Map<string, string>();
  for (const q of WORKDAY_QUERIES) {
    for (let offset = 0; offset < WORKDAY_MAX_PER_QUERY; offset += 20) {
      const d = await workdayPost(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: q });
      if (!d) break;
      const postings = (d.jobPostings as Array<{ title?: string; externalPath?: string }> | undefined) ?? [];
      for (const j of postings) {
        if (j.externalPath && j.title && !found.has(j.externalPath)) found.set(j.externalPath, j.title);
      }
      if (postings.length < 20) break;
    }
  }

  const matches = [...found].filter(([, title]) =>
    isDesignRole(title) && !(src.exclude ?? []).some((re) => re.test(title)),
  );

  const results = await mapLimit(matches, 4, async ([path, listTitle]): Promise<CandidateJob | null> => {
    const canonical = `${base}/${src.site}${path}`;
    if (knownUrls?.has(canonical)) return null;
    try {
      const res = await fetch(`${api}${path}`, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const d = await res.json() as {
        jobPostingInfo?: {
          title?: string; jobDescription?: string; location?: string; additionalLocations?: string[];
          timeType?: string; remoteType?: string; externalUrl?: string;
        };
      };
      const info = d.jobPostingInfo;
      if (!info) return null;
      const title = info.title ?? listTitle;
      const locations = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean) as string[];
      const location = locations.slice(0, 3).join(" · ") + (locations.length > 3 ? ` +${locations.length - 3}` : "");
      const description = htmlToText(info.jobDescription);
      return {
        title, company: src.name, companyUrl: src.url, companyDomain: src.domain,
        jobUrl: info.externalUrl ?? canonical,
        location: location || "Not specified",
        remote: /remote/i.test(`${info.remoteType ?? ""} ${location} ${title}`),
        description,
        compensation: extractCompensation(description),
        typeOfRole: mapTypeOfRole(info.timeType, title),
        logoHint: null,
        origin: `workday:${src.tenant}`,
      };
    } catch { return null; }
  });

  return results.filter((r): r is CandidateJob => r !== null);
}

/** Fetch every configured source concurrently and return all design roles. */
export async function fetchAllCandidates(opts: { knownUrls?: Set<string> } = {}): Promise<CandidateJob[]> {
  const [atsResults, workdayResults, remotive, remoteok, wwr] = await Promise.all([
    mapLimit(SOURCES, 8, (src) =>
      src.ats === "greenhouse" ? fetchGreenhouse(src)
      : src.ats === "lever" ? fetchLever(src)
      : fetchAshby(src),
    ),
    mapLimit(WORKDAY_SOURCES, 4, (src) => fetchWorkday(src, opts.knownUrls)),
    fetchRemotive(), fetchRemoteOK(), fetchWeWorkRemotely(),
  ]);
  return [...atsResults.flat(), ...workdayResults.flat(), ...remotive, ...remoteok, ...wwr];
}

export function dedupKey(company: string, title: string): string {
  return `${company.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

// ── Ingest / prune ───────────────────────────────────────────────────────
// Shared by the daily cron and the admin trigger so there is exactly one
// implementation of "add new jobs" and "retire dead ones".

export interface IngestResult {
  added: number;
  skipped: number;
  withDescription: number;
  withCompensation: number;
  withLogo: number;
  errors: string[];
}

export async function ingestNewJobs(): Promise<IngestResult> {
  const { db } = await import("@/lib/db");

  const existing = await db.job.findMany({
    where: { active: true },
    select: { jobUrl: true, title: true, company: true },
  });
  const seenUrls = new Set(existing.map((j) => j.jobUrl).filter(Boolean) as string[]);
  const seenKeys = new Set(existing.map((j) => dedupKey(j.company ?? "", j.title ?? "")));

  const all = await fetchAllCandidates({ knownUrls: seenUrls });
  const fresh: CandidateJob[] = [];
  for (const j of all) {
    if (!j.jobUrl || !j.company) continue;
    const k = dedupKey(j.company, j.title);
    if (seenUrls.has(j.jobUrl) || seenKeys.has(k)) continue;
    seenUrls.add(j.jobUrl);
    seenKeys.add(k);
    fresh.push(j);
  }

  const result: IngestResult = {
    added: 0, skipped: all.length - fresh.length,
    withDescription: 0, withCompensation: 0, withLogo: 0, errors: [],
  };

  for (const job of fresh) {
    try {
      // Board aggregators don't report the employer's own domain, so recover
      // it before attempting a logo.
      let domain = job.companyDomain ?? domainOf(job.companyUrl);
      let companyUrl = job.companyUrl;
      if (!domain) {
        const known = knownCompanySite(job.company);
        if (known) {
          domain = known.domain;
          companyUrl = companyUrl ?? known.url;
        } else {
          domain = await guessDomain(job.company);
          if (domain) companyUrl = companyUrl ?? `https://${domain}`;
        }
      }
      const logoUrl = await resolveAndStoreLogo(job.company, domain, job.logoHint, job.jobUrl);

      await db.job.create({
        data: {
          posterFirstName: "Aarron",
          posterLastName: "Walter",
          posterEmail: "aarronwalter@gmail.com",
          company: job.company,
          companyUrl,
          companyLogoUrl: logoUrl,
          title: job.title,
          role: mapRole(job.title),
          leadership: isLeadershipRole(job.title),
          location: job.location || "Not specified",
          remote: job.remote,
          typeOfRole: job.typeOfRole,
          experienceLevel: mapExperience(job.title),
          compensation: job.compensation,
          description: job.description,
          jobUrl: job.jobUrl,
          active: true,
          featured: false,
          stripePaymentStatus: "paid",
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          // null keeps this job out of the talent-matching digest cron.
          matchFrequency: null,
        },
      });
      result.added++;
      if (job.description) result.withDescription++;
      if (job.compensation) result.withCompensation++;
      if (logoUrl) result.withLogo++;
    } catch (err) {
      result.errors.push(`${job.company} — ${job.title}: ${String(err).slice(0, 160)}`);
    }
  }

  return result;
}

/**
 * Phrases that mean the role is closed. Boards frequently keep serving a 200
 * page for a filled role and say so only in the copy — and some (Getro) answer
 * 403 to HEAD while serving the page fine over GET — so status codes alone
 * leave stale listings on the board.
 */
const CLOSED_PHRASES = [
  "no longer accepting",
  "no longer available",
  "no longer open",
  "position has been filled",
  "this position is closed",
  "this job is closed",
  "posting is closed",
  "applications are closed",
  "job posting has expired",
  "this role has been filled",
];

/** Retire jobs whose source listing is gone or explicitly closed. */
export async function pruneExpiredJobs(): Promise<{
  checked: number; pruned: number; byStatus: number; byCopy: number;
}> {
  const { db } = await import("@/lib/db");
  const jobs = await db.job.findMany({
    where: { active: true, jobUrl: { not: null } },
    select: { id: true, jobUrl: true },
  });

  let byStatus = 0;
  let byCopy = 0;

  await mapLimit(jobs, 8, async (job) => {
    if (!job.jobUrl) return;
    const retire = async () => {
      await db.job.update({ where: { id: job.id }, data: { active: false } });
    };

    try {
      const res = await politeFetch(job.jobUrl, { timeoutMs: 12000, accept: "text/html,*/*", tries: 1 });
      if (!res) return; // network hiccup — leave it alone

      if (res.status === 404 || res.status === 410) {
        await retire();
        byStatus++;
        return;
      }
      if (!res.ok) return; // 403/429/5xx: bot check or transient, not evidence

      // Visible text only. Script-rendered pages (Dayforce, other SPA portals)
      // ship their whole interface-string bundle in the HTML, "this job posting
      // is no longer available" included, so scanning raw HTML closed open
      // roles: Aetonix was retired the morning after it was added.
      const text = (htmlToText((await res.text()).slice(0, 2_000_000)) ?? "").toLowerCase();
      if (CLOSED_PHRASES.some((p) => text.includes(p))) {
        await retire();
        byCopy++;
      }
    } catch { /* leave it alone */ }
  });

  return { checked: jobs.length, pruned: byStatus + byCopy, byStatus, byCopy };
}

// ── Logo storage ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "company";
}

/**
 * Resolve the best logo for a company and mirror it into Vercel Blob so the
 * board isn't hotlinking third-party assets. Returns the blob URL, or null if
 * nothing good enough was found (better no logo than a blurry one — JobCard
 * falls back to a colored initial).
 *
 * Results are memoized per company for the lifetime of the request, since a
 * single run typically sees many roles from the same employer.
 */
const logoMemo = new Map<string, Promise<string | null>>();

export async function resolveAndStoreLogo(
  company: string,
  domain: string | null | undefined,
  hint?: string | null,
  jobUrl?: string | null,
): Promise<string | null> {
  // jobUrl belongs in the key: postings for one employer don't all display a
  // logo (a closed listing may show none), so sharing a single result across
  // them let one bad page starve the rest. The expensive site scan is cached
  // separately by domain, so per-posting resolution stays cheap.
  const key = `${slugify(company)}|${domain ?? ""}|${hint ?? ""}|${jobUrl ?? ""}`;
  const cached = logoMemo.get(key);
  if (cached) return cached;

  const task = (async () => {
    const best = await resolveBestLogo(domain, hint, company, jobUrl);
    if (!best) return null;
    try {
      // Reuse the bytes gathered during scoring — no second request.
      const body = best.buf;
      const { put } = await import("@vercel/blob");
      // Deterministic path + no random suffix means re-runs replace the old
      // file in place rather than piling up copies. (@vercel/blob 0.27 permits
      // overwrite by default; v1+ would need allowOverwrite: true here.)
      const result = await put(`logos/${slugify(company)}.${best.ext}`, body, {
        access: "public",
        contentType: best.contentType,
        addRandomSuffix: false,
      });
      return result.url;
    } catch {
      return null;
    }
  })();

  logoMemo.set(key, task);
  // Module state survives between invocations on a warm instance, so a failed
  // lookup must not be cached — otherwise one transient error would keep that
  // company logo-less for the life of the container.
  task.then((url) => { if (!url) logoMemo.delete(key); }).catch(() => logoMemo.delete(key));
  return task;
}
