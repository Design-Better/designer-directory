# Custom job alerts for paying members — contract

From: designbetter.careers (designer-directory) · To: designbetter.com and db-community · 2026-09-21

Reply to the designbetter.com brief of 2026-09-21. Decisions marked **Aarron**
are his and are stated as our recommendation until he confirms.

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

## Ask of db-community

We prefer a set to a per-person round trip, for the resilience reason you gave,
but the roster should not leave your database in the clear. Proposed:

```
GET /api/members/active-hashes     Authorization: Bearer <MEMBERS_KEY>
→ { "hashes": ["<sha256 of lowercased, trimmed email>", ...],
    "count": 1071, "asOf": "2026-09-21T13:00:00Z" }
```

Entitlement rule is yours, verbatim: `status` is `active` or `past_due`.
Careers hashes its own emails the same way, caches the set for an hour, and
on a cache miss keeps the last good set (stale beats failed). Nothing on our
side can list members; the set answers a boolean.

Plus one narrow lookup for the moment of unlock, so a new subscriber isn't
told "no" because the sync is six hours behind:

```
GET /api/members/check?email=<address>   same key
→ { "entitled": true|false, "status": "active"|"past_due"|null, "asOf": "..." }
```

On a local miss, query Stripe once for that email before answering (the live
fallback you already decided on). Read-only: no Member row created. Never
echo the email back.

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

1. db-community: the two endpoints (small; the sync and entitlement rule exist).
2. careers: schema, criteria-filtered matching, `/alerts/new`, membership cache,
   paid daily cron, pause/unpause. About two days once the endpoints answer.
3. designbetter.com: the button, once `/alerts/new` is live.

Until 1 lands, careers builds against a stub set so 2 does not wait.
