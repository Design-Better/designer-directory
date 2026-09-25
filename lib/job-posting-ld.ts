import type { Job } from "@prisma/client";

/**
 * schema.org JobPosting for a job page, so the board can appear in Google
 * Jobs. Every field is derived from stored data or omitted; nothing is
 * guessed. In particular `baseSalary` appears only when the stored
 * compensation string parses into a currency, a unit and one or two figures.
 */

const EMPLOYMENT: Record<string, string> = {
  "Full-time": "FULL_TIME",
  "Part-time": "PART_TIME",
  Contract: "CONTRACTOR",
  Internship: "INTERN",
  Advising: "OTHER",
};

const CURRENCY: Array<[RegExp, string]> = [
  [/C\$|CAD/, "CAD"],
  [/A\$|AUD/, "AUD"],
  [/£|GBP/, "GBP"],
  [/€|EUR/, "EUR"],
  [/\$|USD/, "USD"],
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** Stored descriptions are plain text; Google wants HTML. Paragraphs become <p>. */
export function descriptionHtml(text: string | null | undefined, fallback: string): string {
  const src = (text ?? "").trim();
  if (!src) return `<p>${esc(fallback)}</p>`;
  return src
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * "$110k–$169k/yr", "$146.6K – $219.8K", "$70 – $105 per hour", "£90k–£110k/yr",
 * "$200K – $225K • Offers Equity". Returns null for anything it can't read
 * with confidence, which is the right answer for structured data.
 */
export function parseSalary(comp: string | null | undefined):
  | { currency: string; unitText: "HOUR" | "MONTH" | "YEAR"; minValue: number; maxValue: number }
  | null {
  if (!comp) return null;
  const currency = CURRENCY.find(([re]) => re.test(comp))?.[1];
  if (!currency) return null;

  const nums = [...comp.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kK])?/g)]
    .map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;

  // Pay per quarter, term, course or project has no schema.org unit that
  // is honest (a quarterly stipend is not an annual salary), so omit it.
  if (/quarter|semester|per term|per course|per project|stipend|per week|weekly|per day|daily/i.test(comp)) return null;
  const unitText: "HOUR" | "MONTH" | "YEAR" = /hour|\/hr\b|hourly/i.test(comp)
    ? "HOUR"
    : /month/i.test(comp)
      ? "MONTH"
      : "YEAR";

  // Sanity bounds per unit so a stray "401k" or "2 years" can't become pay.
  const [lo, hi] = unitText === "HOUR" ? [5, 1000] : unitText === "MONTH" ? [500, 100000] : [10000, 2000000];
  const inRange = nums.filter((n) => n >= lo && n <= hi);
  if (!inRange.length) return null;

  const minValue = Math.min(...inRange.slice(0, 2));
  const maxValue = Math.max(...inRange.slice(0, 2));
  return { currency, unitText, minValue, maxValue };
}

const COUNTRY_HINTS: Array<[RegExp, string]> = [
  [/\b(united states|usa|u\.s\.|\bus\b|remote - us|new york|san francisco|seattle|austin|chicago|los angeles|boston|denver|atlanta|portland|miami|dallas|houston|phoenix|,\s?(?:[A-Z]{2}))\b/i, "US"],
  [/\b(united kingdom|\buk\b|london|manchester|edinburgh|england)\b/i, "GB"],
  [/\b(canada|toronto|vancouver|montreal|ottawa|,\s?ON\b|,\s?BC\b)\b/i, "CA"],
  [/\b(australia|sydney|melbourne)\b/i, "AU"],
  [/\b(germany|berlin|munich)\b/i, "DE"],
  [/\b(netherlands|amsterdam)\b/i, "NL"],
  [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(india|bangalore|bengaluru|hyderabad|mumbai)\b/i, "IN"],
];

function countryOf(location: string): string | undefined {
  return COUNTRY_HINTS.find(([re]) => re.test(location))?.[1];
}

export function jobPostingLd(job: Job, pageUrl: string): Record<string, unknown> {
  const country = countryOf(job.location);
  const locality = job.location.split(/[·;|]|\s-\s/)[0].trim();
  const salary = parseSalary(job.compensation);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: descriptionHtml(job.description, `${job.title} at ${job.company}.`),
    datePosted: job.createdAt.toISOString(),
    ...(job.expiresAt ? { validThrough: job.expiresAt.toISOString() } : {}),
    employmentType: EMPLOYMENT[job.typeOfRole] ?? "OTHER",
    hiringOrganization: {
      "@type": "Organization",
      name: job.company,
      ...(job.companyUrl ? { sameAs: job.companyUrl } : {}),
      ...(job.companyLogoUrl ? { logo: job.companyLogoUrl } : {}),
    },
    identifier: { "@type": "PropertyValue", name: job.company, value: job.id },
    url: pageUrl,
    directApply: false,
  };

  if (job.remote) {
    ld.jobLocationType = "TELECOMMUTE";
    if (country) ld.applicantLocationRequirements = { "@type": "Country", name: country };
  }
  if (!job.remote || locality) {
    ld.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(locality && !/^remote$/i.test(locality) ? { addressLocality: locality } : {}),
        ...(country ? { addressCountry: country } : {}),
      },
    };
  }
  if (salary) {
    ld.baseSalary = {
      "@type": "MonetaryAmount",
      currency: salary.currency,
      value: {
        "@type": "QuantitativeValue",
        ...(salary.minValue === salary.maxValue
          ? { value: salary.minValue }
          : { minValue: salary.minValue, maxValue: salary.maxValue }),
        unitText: salary.unitText,
      },
    };
  }
  return ld;
}
