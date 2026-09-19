import { LOCATION_ALIASES } from "./utils";

export const ROLE_SEO: Record<
  string,
  { slug: string; singular: string; plural: string; hireCopy: string; jobsCopy: string }
> = {
  "Product Design": {
    slug: "product-design",
    singular: "Product Designer",
    plural: "Product Designers",
    hireCopy:
      "Find experienced product designers who own the full design process — from discovery through delivery. Senior talent, vetted community.",
    jobsCopy:
      "Browse open product design roles at companies building great software and hardware experiences.",
  },
  "UX/UI Design": {
    slug: "ux-design",
    singular: "UX/UI Designer",
    plural: "UX/UI Designers",
    hireCopy:
      "Find UX/UI designers skilled in user research, prototyping, and crafting intuitive digital experiences that convert and retain.",
    jobsCopy:
      "Browse UX and UI design roles at companies that take design seriously.",
  },
  "Branding": {
    slug: "branding",
    singular: "Brand Designer",
    plural: "Brand Designers",
    hireCopy:
      "Find brand designers who can define, refresh, or evolve your visual identity — from logo to full brand system.",
    jobsCopy:
      "Browse branding and visual identity roles at agencies, startups, and established brands.",
  },
  "Design Systems": {
    slug: "design-systems",
    singular: "Design Systems Designer",
    plural: "Design Systems Designers",
    hireCopy:
      "Find design systems specialists who build scalable component libraries, tokens, and design infrastructure that accelerates your team.",
    jobsCopy:
      "Browse design systems roles at companies investing in design infrastructure and consistency at scale.",
  },
  "DesignOps": {
    slug: "designops",
    singular: "DesignOps Professional",
    plural: "DesignOps Professionals",
    hireCopy:
      "Find DesignOps professionals who streamline workflows, manage tooling, and help design teams move faster and more consistently.",
    jobsCopy: "Browse DesignOps roles helping design organizations scale effectively.",
  },
  "User Research": {
    slug: "user-research",
    singular: "User Researcher",
    plural: "User Researchers",
    hireCopy:
      "Find user researchers who generate actionable insights through qualitative and quantitative methods to drive smarter product decisions.",
    jobsCopy: "Browse user research roles at product-led companies.",
  },
  "Service Design": {
    slug: "service-design",
    singular: "Service Designer",
    plural: "Service Designers",
    hireCopy:
      "Find service designers who map and transform complex end-to-end experiences for customers and internal teams alike.",
    jobsCopy: "Browse service design roles across healthcare, finance, government, and enterprise.",
  },
  "Motion Design": {
    slug: "motion-design",
    singular: "Motion Designer",
    plural: "Motion Designers",
    hireCopy:
      "Find motion designers who bring interfaces, brands, and marketing to life with purposeful animation and video.",
    jobsCopy: "Browse motion design roles at product companies, studios, and agencies.",
  },
  "Illustration": {
    slug: "illustration",
    singular: "Illustrator",
    plural: "Illustrators",
    hireCopy:
      "Find illustrators for product UI, editorial, marketing campaigns, and brand storytelling — across every style.",
    jobsCopy: "Browse illustration roles at product companies, publishers, and creative studios.",
  },
  "Product Management": {
    slug: "product-management",
    singular: "Product Manager",
    plural: "Product Managers",
    hireCopy:
      "Find product managers with strong design sensibility who bridge user needs, business goals, and engineering execution.",
    jobsCopy: "Browse product management roles at design-forward companies.",
  },
};

export const SEO_LOCATIONS: Record<
  string,
  { slug: string; label: string; preposition: string }
> = {
  "Remote": { slug: "remote", label: "Remote", preposition: "" },
  "New York, NY": { slug: "new-york", label: "New York", preposition: "in" },
  "San Francisco / Bay Area": { slug: "san-francisco", label: "San Francisco", preposition: "in" },
  "Los Angeles, CA": { slug: "los-angeles", label: "Los Angeles", preposition: "in" },
  "Seattle, WA": { slug: "seattle", label: "Seattle", preposition: "in" },
  "Austin, TX": { slug: "austin", label: "Austin", preposition: "in" },
  "Boston, MA": { slug: "boston", label: "Boston", preposition: "in" },
  "Chicago, IL": { slug: "chicago", label: "Chicago", preposition: "in" },
  "Denver, CO": { slug: "denver", label: "Denver", preposition: "in" },
  "Miami, FL": { slug: "miami", label: "Miami", preposition: "in" },
  "London": { slug: "london", label: "London", preposition: "in" },
  "Berlin": { slug: "berlin", label: "Berlin", preposition: "in" },
  "Amsterdam": { slug: "amsterdam", label: "Amsterdam", preposition: "in" },
  "Toronto, Canada": { slug: "toronto", label: "Toronto", preposition: "in" },
  "Sydney": { slug: "sydney", label: "Sydney", preposition: "in" },
};

export function roleFromSlug(slug: string): string | undefined {
  return Object.entries(ROLE_SEO).find(([, v]) => v.slug === slug)?.[0];
}

export function locationFromSlug(slug: string): string | undefined {
  return Object.entries(SEO_LOCATIONS).find(([, v]) => v.slug === slug)?.[0];
}

/** Below this many matching profiles a /hire/[role]/[location] page is noindex and out of the sitemap. */
export const HIRE_LOCATION_MIN_PROFILES = 3;

export function locationWhereClause(locationKey: string) {
  const terms = [locationKey, ...(LOCATION_ALIASES[locationKey] ?? [])];
  return {
    OR: terms.map((term) => ({
      location: { contains: term, mode: "insensitive" as const },
    })),
  };
}
