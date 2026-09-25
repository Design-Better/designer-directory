# Custom job alerts: handoff to the designbetter.com agent

From: designbetter.careers (designer-directory) · 2026-09-21

You sent us a brief for paid custom job alerts. Here is what we built, the
decisions Aarron made, and the two things still needed from you.

## Decisions

- **Profile-based alerts stay free for everyone, now and later.** Only saved
  searches with explicit criteria are the paid tier. Nobody who opted in loses
  anything; the five existing subscribers are untouched. (The number you
  asked for was 5.)
- **Paid cadence:** every weekday morning, weekly, or every two weeks.
- **Up to five saved searches** per person, one email per person per run
  however many fired, and the same rules as before: three-role minimum or
  nothing is sent, one role per employer, never the same role twice, one-click
  stop.

## What is live on designbetter.careers

- **Entry point:** `GET https://designbetter.careers/alerts/new?<criteria>`.
  Criteria use the exact parameter names and values of `/api/v1/jobs`, so a
  filtered board URL is an alert. Recognised: `q`, `role`, `level`, `type`,
  `company`, `location`, `remote`, `leadership`, `salary`, `salaryMin`
  (annual floor, compared against the job's listed range). Unknown keys are
  ignored. Add `utm_source=designbetter.com` so we can see the traffic.
- **The flow, for an unidentified visitor:** the page shows the criteria as a
  label, asks for an email (first name optional), and sends a sign-in link.
  Nothing is created until the link is clicked. On click, a private designer
  row exists if one didn't (not visible to employers; a directory profile is
  optional and offered afterwards).
- **Membership check** on the sign-in address; on a miss, the page says we
  couldn't find a subscription under that address and offers a field for the
  address they subscribe with, plus a subscribe link. Never a bare "not a
  member" wall.
- **Then the form**, seeded from the criteria: name, role, leadership,
  experience, type, remote, location, companies, keyword, pay listed, pay
  floor, cadence. Saving lands on the alerts page where searches can be
  paused, resumed, or deleted. Quiet weeks are stated as a normal state, with
  the last-sent date shown.
- **Behind it:** membership re-checked before every send. Roster from
  db-community when it answers; otherwise the status recorded at unlock,
  trusted for 30 days. A lapsed member's searches pause and resume on return.

## What we need from you

1. **The button.** Once a visitor has filtered your board, show
   `Email me these jobs — <your facet label>` linking to
   `https://designbetter.careers/alerts/new?<current query string>&utm_source=designbetter.com`.
   Pass the parameters through as you already send them to the API; don't
   rename or reformat. Your membership cookie may decide whether to show the
   button or a "subscriber benefit" hint; it decides nothing on our side.
2. **Copy in your flow, before the click:** "You'll confirm your email; a
   Design Better subscription is required for saved searches; a directory
   profile is optional." Our page repeats it, but people should know before
   they leave your site.

Nothing to post to us, no shared secret, no auth to implement.

## Membership

db-community's endpoints shipped 2026-09-25: `POST /api/members/entitlement`
(batch) and `GET /api/members/check` (live). Careers is wired to both.
Self-serve unlock goes live once careers has `MEMBERS_API_URL` and
`MEMBERS_KEY` set on Vercel; careers will confirm when it does. Don't ship
the "Email me these jobs" button before that.

Saved searches are for annual subscribers (annual, comp, gift) as of
2026-09-25; monthly subscribers are told so on our page. If your button or
its helper text names the benefit, say annual.

## To confirm with Aarron

- Subscribe URL for non-members is confirmed: `https://designbetterpodcast.com/subscribe`
  (with UTMs). Use the same one if you link to it.
- Whether to show saved-search counts in the Friday funnel report (we log
  `custom_request` and `custom_saved` events already).
