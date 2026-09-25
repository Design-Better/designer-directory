# Custom job alerts for paying members — contract

From: designbetter.careers (designer-directory) · To: designbetter.com and db-community · 2026-09-21

Reply to the designbetter.com brief of 2026-09-21. **Aarron confirmed on 2026-09-21:**
profile alerts stay free for everyone; saved searches are the paid tier; paid
cadence is daily, weekly, or biweekly. The careers side is built and live; see
`designbetter-com-handoff.md` for what designbetter.com still builds.

## The number you asked for

Designers with `alertFrequency != NONE` today: **5** (4 weekly, 1 monthly), out
of 319 invited on 2 September. Four have received alerts (80 roles), and 5
people have clicked Apply from an alert or invitation email.

So the profile-based tier is small but real, and it was offered as free two
weeks ago. **Recommendation (Aarron):** profile-based alerts stay free exactly
as they are; custom saved searches are the paid tier. Gating the existing five
would take something from people who just said yes to us.

## What careers will build

**Schema.** New `JobAlert`: `id`, `designerId`, `name`, `criteria` (JSON in
the `/api/v1/jobs` query shape), `frequency` (`DAILY | WEEKLY | BIWEEKLY`),
`lastSentAt`, `pausedAt`, `pausedReason` (`not_member | user | thin`). A
designer can hold several. `Designer` gains `memberEmail` (a second address
for the membership match), `memberStatus`, `memberCheckedAt`.

**Matching.** Criteria are hard filters applied *before* `scoreDesigner`, which
then ranks what survives. One scorer, no drift. The existing rules stand:
`MIN_MATCHES` 3, one role per employer, `JobAlertLog` dedupe **per designer**
(a role is never sent twice, whichever search found it), the cadence link and
the one-click stop.

**Cadence for paid (Aarron):** daily (08:00 UTC, after the 07:00 ingest),
weekly, or every two weeks. Free stays weekly, biweekly, monthly.

**Quiet weeks are a state, not a failure.** The alert's page shows "Nothing
new matched this week; we'll send when three roles do" with the date of the
last send. Daily alerts keep the floor at 3 unless Aarron lowers it; we would
rather a daily alert skips than sends one role.

**Paid gate, checked every run.** Before each send, careers checks membership
for the designer's email and `memberEmail`. Not a member → the custom alerts
are paused with `pausedReason: not_member`, never deleted; a resubscribe
unpauses them at the next run. Profile-based alerts are unaffected.

## db-community's API (as shipped, 2026-09-25)

The hashed roster we first proposed (`/api/members/active-hashes`) was not
built and returns 404 permanently. db-community shipped a batch lookup
instead, and careers uses it:

```
POST https://designbetter.community/api/members/entitlement
  Authorization: Bearer <MEMBERS_KEY>
  { "emails": ["a@example.com", "b@example.com"] }        // max 500 per call
→ { "asOf": "...", "count": 2,
    "results": [ { "email": "a@example.com", "entitled": true,  "status": "active", "plan": "annual" },
                 { "email": "b@example.com", "entitled": false, "status": null,     "plan": null } ] }
```

Results come back in the order and length sent; unknown addresses are
`entitled: false`. Local data only, no live Stripe call. `plan` is
`annual | monthly | comp | gift`.

For the moment of unlock, a live point check that falls back to Stripe:

```
GET https://designbetter.community/api/members/check?email=<address>   same key
→ { "entitled": true|false, "status": ..., "plan": ... }
```

"/entitlement for your cron, /check at the moment of unlock." Rate limit:
30 requests a minute. The entitlement rule is db-community's: `status` is
`active` or `past_due`.

**How careers uses it** (`lib/membership.ts`):
- The cron makes one batch call per run for every saved-search owner (both
  addresses), pauses or unpauses from `entitled`, and records the answer on
  the designer.
- The unlock page and the save action do a batch lookup, then `/check` on
  each address, so a subscriber from five minutes ago gets in.
- If db-community can't be reached, careers trusts the recorded status for
  30 days. Stale beats failed; an outage never pauses a paying member.
- An admin grant (`memberStatus: "granted"`) is never overwritten by a
  community answer and lasts 30 days.

## Ask of designbetter.com

**Entry point.** Send people to a URL; don't post to us. The filter state is
the alert, in the same parameter names as `/api/v1/jobs`:

```
https://designbetter.careers/alerts/new?role=Product%20Design&level=Late%20Career%20(9%2B%20years)&remote=true&salary=true&utm_source=designbetter.com
```

Your button label can be built from the facets you already render.

**Authentication.** Assume the arriving person is unidentified. Careers asks
for an email, sends a sign-in link (the existing magic-link flow), and only a
clicked link creates or attaches anything. Your membership cookie may decide
which button to show; it decides nothing about who gets email, as you said.

**Profile requirement.** No full profile needed. A verified email and a first
name create a private `Designer` row (`publicProfile: false`, `hidden: true`)
that holds the alerts. The confirmation page invites them to publish a profile;
it doesn't require it. Say in your flow: "You'll confirm your email; a directory
profile is optional."

**Membership mismatch copy** (Aarron's to edit): "We couldn't find a Design
Better subscription under {email}. If you subscribe with a different address,
add it here." Then a second field, stored as `memberEmail`.

## Sequence

1. db-community: the two endpoints. Shipped 2026-09-25 (`/entitlement` and `/check`).
2. careers: schema, criteria-filtered matching, `/alerts/new`, membership cache,
   paid daily cron, pause/unpause. About two days once the endpoints answer.
3. designbetter.com: the button, once `/alerts/new` is live.

`MEMBERS_STUB_EMAILS` stands in for db-community in development.
