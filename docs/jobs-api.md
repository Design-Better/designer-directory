# Jobs API for agents

Public, read-only JSON feed of the active roles on designbetter.careers, for
other agents and tools to query and filter. No key. CDN-cached five minutes.
CORS open. Built 2026-09-18.

Endpoints:

```
GET https://designbetter.careers/api/v1/jobs          list + filter + facets
GET https://designbetter.careers/api/v1/jobs/{id}     one job with full description
```

## Query parameters (`/api/v1/jobs`)

| Param | Values | Notes |
| --- | --- | --- |
| `q` | text | case-insensitive match on title, company, description |
| `role` | comma list | `UX/UI Design`, `Product Design`, `Branding`, `Design Systems`, `DesignOps`, `User Research`, `Service Design`, `Motion Design`, `Illustration`, `Product Management`, `Engineering`, `Marketing`, `Project/Program Management`, `Other` |
| `level` | comma list | `Early Career (0-2 years)`, `Mid Career (3-8 years)`, `Late Career (9+ years)` |
| `type` | comma list | `Full-time`, `Part-time`, `Contract`, `Advising`, `Internship` |
| `company` | comma list | exact, case-insensitive |
| `location` | text | case-insensitive substring of the location string |
| `remote` | `true` / `false` | |
| `leadership` | `true` / `false` | Head of, Director, VP, design manager roles |
| `salary` | `true` / `false` | only roles that list pay |
| `since` | `7d`, `24h`, or ISO date | posted on or after |
| `sort` | `newest` (default), `oldest`, `balanced` | balanced = one role per employer per pass, like the site's default |
| `limit` | 1–200 | default 50 |
| `offset` | integer | use `nextOffset` from the response |
| `include` | `description` | adds the full text to each job (larger payload) |

Unknown `role`, `level`, or `type` values return `400` with the allowed lists.
URL-encode values with spaces and slashes (`role=Product%20Design`, `role=UX%2FUI%20Design`).

## Response

```jsonc
{
  "ok": true,
  "generatedAt": "2026-09-18T14:02:11.000Z",
  "total": 118,            // matches across all pages
  "count": 50,             // in this page
  "limit": 50, "offset": 0, "nextOffset": 50,   // null when this is the last page
  "filters": { "role": ["Product Design"], "remote": true, "sort": "newest", ... },
  "facets": {              // counts over the whole filtered set, for narrowing
    "role": { "Product Design": 118 },
    "experienceLevel": { "Late Career (9+ years)": 61, "Mid Career (3-8 years)": 52, ... },
    "typeOfRole": { "Full-time": 115, "Contract": 3 },
    "remote": { "true": 118 },
    "leadership": { "false": 96, "true": 22 },
    "hasSalary": { "true": 70, "false": 48 },
    "company": { "Adobe": 12, ... },   // top 25
    "companiesTotal": 64
  },
  "jobs": [
    {
      "id": "cmu56lbbz000cjq04l5pm7a46",
      "title": "Senior Product Designer",
      "company": "Capital One",
      "companyUrl": "https://capitalone.com",
      "companyLogoUrl": "https://….public.blob.vercel-storage.com/logos/….png",
      "companySize": null,
      "location": "Toronto, ON",
      "remote": false,
      "role": "Product Design",
      "experienceLevel": "Mid Career (3-8 years)",
      "typeOfRole": "Full-time",
      "compensation": "$109k–$124k/yr",   // null when the posting lists none
      "leadership": false,
      "visaSponsorship": false,
      "featured": false,
      "postedAt": "2026-09-17T07:04:12.000Z",
      "expiresAt": null,
      "url": "https://designbetter.careers/jobs/cmu56lbbz000cjq04l5pm7a46",   // our page: link here for attribution
      "applyUrl": "https://…employer…?utm_source=designbetter.careers&utm_medium=job_board&utm_campaign=design_jobs"
    }
  ]
}
```

`/api/v1/jobs/{id}` returns `{ ok, job }` with the same shape plus `description`,
or `404` when the job is closed or unknown.

## Examples

```
/api/v1/jobs?role=Product%20Design&remote=true&salary=true&limit=20
/api/v1/jobs?leadership=true&since=7d&sort=balanced
/api/v1/jobs?q=design%20systems&level=Late%20Career%20(9%2B%20years)
/api/v1/jobs?company=Adobe,Figma&include=description
/api/v1/jobs?location=london
```

## How the data behaves

- Roles are ingested daily around 07:00 UTC from employers' own applicant
  tracking systems (Greenhouse, Lever, Ashby, Workday) and a few curated feeds,
  and pruned daily when the employer closes them. A job that disappears from
  the feed is closed, not deleted from the world.
- `compensation` is the employer's own figure, normalised to `$110k–$169k/yr`
  style where possible; roughly half of roles carry one.
- `leadership` is a title-based classification (Head of, Director, VP, Chief,
  design manager). `role` is the discipline. They're independent.
- `companySize` is rarely set. Don't filter on it.

---

## Prompt to hand to another agent

Copy everything between the lines.

---

You can query the Design Better Careers job board, a curated list of design
roles (product, UX/UI, brand, design systems, research, motion, design
leadership) pulled daily from employers' own career sites.

**Endpoint:** `GET https://designbetter.careers/api/v1/jobs` — public JSON, no
key. One job: `GET https://designbetter.careers/api/v1/jobs/{id}`.

**Filter with query params** (comma lists allowed where noted): `q` (text),
`role` (list: `Product Design`, `UX/UI Design`, `Branding`, `Design Systems`,
`DesignOps`, `User Research`, `Service Design`, `Motion Design`), `level` (list:
`Early Career (0-2 years)`, `Mid Career (3-8 years)`, `Late Career (9+ years)`),
`type` (list: `Full-time`, `Part-time`, `Contract`), `company` (list, exact),
`location` (substring), `remote=true`, `leadership=true`, `salary=true`,
`since=7d`, `sort=newest|oldest|balanced`, `limit` (≤200), `offset`,
`include=description`. URL-encode spaces and slashes. A `400` lists the allowed
values if you send an unknown one.

**Response:** `{ total, count, nextOffset, facets, jobs[] }`. Each job has `id`,
`title`, `company`, `location`, `remote`, `role`, `experienceLevel`,
`typeOfRole`, `compensation` (string or null), `leadership`, `postedAt`, `url`,
`applyUrl`. `facets` gives counts by role, level, type, remote, leadership,
salary and top companies over the filtered set; use it to narrow before paging.

**Rules:**
1. When you show a role to a person, link `url` (the designbetter.careers page)
   as the source, and send them to `applyUrl` to apply. Never strip the `utm_`
   parameters from `applyUrl`; they tell the employer where the applicant came
   from.
2. Cache responses for at least 5 minutes and page with `nextOffset`; don't
   loop the endpoint. Data changes once a day.
3. Quote `compensation` as given and say "not listed" when it's null. Don't
   infer pay.
4. Don't republish full descriptions wholesale; summarise and link.
5. A `404` on `/jobs/{id}` means the role closed. Tell the person that rather
   than retrying.

Example: remote senior product design roles with pay listed, newest first:
`https://designbetter.careers/api/v1/jobs?role=Product%20Design&level=Late%20Career%20(9%2B%20years)&remote=true&salary=true&limit=20`

---
