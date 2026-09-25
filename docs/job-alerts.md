# Designer job alerts

Designers in the directory opt in to matched roles by email at a cadence they
choose. Built 2026-09-02. Invitation campaign sent 2026-09-02 to 319 designers (13 batches of 25, 0 errors).

## The pieces

| Piece | Where | Notes |
| --- | --- | --- |
| Opt-in page | `/alerts?token=<editToken>` | No login; the token is the same one the profile-edit links use. `?stop=1` is the one-click unsubscribe. `?status=NOT_LOOKING` pre-selects "I'm set". |
| Matching | `lib/job-alerts.ts` → `pickMatches` | Same scorer as the employer flow (`lib/matching.ts`), run designer→jobs. Threshold 60, one role per employer, max 10, ties broken per designer. |
| Weekly send | `/api/cron/job-alerts`, Tuesdays 14:00 UTC | Cadence enforced per designer (weekly / biweekly / monthly). Sends only with **3+ matches**; otherwise waits and the window widens. Each role is logged in `job_alert_logs` and never re-sent. |
| Invitation | `POST /api/admin/job-alerts {mode:"invite"}` | One-off "still looking? choose a cadence" email with three personal sample roles. Batched; never twice (`alertInviteSentAt`); skips opted-in and not-looking. |
| Hand runs | `POST /api/admin/job-alerts {mode:"alerts"}` | `dryRun:true` previews who would get what. |

Auth for the admin endpoint is `x-admin-secret`. The cron is `Authorization: Bearer $CRON_SECRET`.

## Schema

On `Designer`: `alertFrequency` (NONE / WEEKLY / BIWEEKLY / MONTHLY), `alertOptInAt`,
`alertLastSentAt`, `alertInviteSentAt`, `wantsLeadership`. Table `JobAlertLog`
(designerId, jobId, sentAt; unique per pair).

## Rules and why

- **Minimum three matches or nothing.** A thin alert teaches people to ignore
  the next one. Skipping leaves `alertLastSentAt` alone, so the next run looks
  further back.
- **First alert looks back 14 days** from the run, not from opt-in, so the
  opt-in page's "N roles match right now" is what actually arrives.
- **One role per employer.** Adobe has 34 open; an alert that is a third Adobe
  reads like an ad.
- **Leadership is a preference, not a discipline.** `wantsLeadership` adds +5
  for leadership roles and −10 against them; neutral when unknown, so the
  employer matching flow is unchanged.
- **Saving the opt-in form re-confirms the profile** (`lastConfirmedAt`) and
  un-hides it. Choosing "I'm set" hides it and sets not-looking.
- **Opted-in designers are exempt from `confirm-check`** auto-hiding. The alert
  footer carries its own stop link; the check-in email would be a second nag.
- **Legacy profile values** ("Design Leadership", "Chief of Staff") that predate
  the current role list are shown as "(current)" in the form so saving never
  silently rewrites them.

## Running the invitation

Dry run first, then batches of 25 (Resend rate limits):

```bash
curl -s -X POST https://designbetter.careers/api/admin/job-alerts \
  -H 'x-admin-secret: …' -H 'content-type: application/json' \
  -d '{"mode":"invite","dryRun":true,"limit":5}'
```

Then drop `dryRun` and repeat with `offset: 0` until `done: true`. Sent rows leave the eligible set (`alertInviteSentAt`), so a growing offset would skip people. `emails: [...]`
restricts to specific addresses for a test send. `cohort` is `all` (default),
`visible` or `hidden`.

## Numbers at build time

363 designers: 105 visible and looking, 214 hidden (never re-confirmed), 44 not
looking. Dry run: 100/105 visible and 196/214 hidden would receive a full
ten-role alert today. Invitation eligible: 319.

## Known limits

- Company size contributes almost nothing: only 27 of 645 jobs carry it.
- Role groups are broad (UX/UI ≈ Product ≈ Content). Fine for a first alert;
  tighten with open-rate data.
- Employer de-dup is by normalised name, so "IxDF" and "Interaction Design
  Foundation" count as two. Fix belongs in ingest.

## Funnel report

**Emailed every Friday 13:00 UTC** to `ALERTS_REPORT_TO` (default aarron@aarronwalter.com)
by `/api/cron/alerts-report`. Two columns: this week (last 7 days, distinct
designers) and all time since the invitation. Send it now with
`{"mode":"report","email":true}` on the admin endpoint; `"to"` overrides the recipient.

On demand as JSON:

```bash
curl -s -X POST https://designbetter.careers/api/admin/job-alerts \
  -H "x-admin-secret: …" -H "content-type: application/json" -d '{"mode":"report"}'
```

Returns `invited`, `optedIn` by cadence, `nowNotLooking`, `confirmedWithoutAlerts`
(saved the form since the invite but chose no emails), and `byKind` counts for
`invite_click`, `prefs_saved`, `stop`, `job_view`, `apply_click` (events, distinct
designers, distinct jobs), plus `prefsBreakdown` by status/cadence. The owner
preview row is excluded.

## Custom saved-search alerts (paid tier, built 2026-09-21)

Profile-based alerts above stay free for everyone. Paying Design Better
subscribers can also save up to five searches with explicit criteria.

| Piece | Where |
| --- | --- |
| Entry page | `/alerts/new?<criteria>` (criteria = `/api/v1/jobs` params); `?token=` once signed in |
| Sign-in link, unlock, save, pause, delete | `app/alerts/new/actions.ts` |
| Criteria parse/filter/describe | `lib/job-criteria.ts` (hard filters before `scoreDesigner`) |
| Membership | `lib/membership.ts`: db-community roster (hashed, hourly) when `MEMBERS_API_URL`/`MEMBERS_KEY` are set; otherwise the status recorded at unlock, trusted 30 days |
| Sender | `sendCustomAlerts` in `lib/job-alerts.ts`; cron `/api/cron/custom-alerts` weekdays 08:00 UTC |
| Admin | `POST /api/admin/job-alerts` modes `custom` (`dryRun`), `grant` (`grantEmail`, `revoke`) |
| Management | saved searches listed on `/alerts?token=` with pause/resume/delete |
| Board button | "Email me these jobs" on `/jobs` once a filter is active |

Rules carried over: three-match floor, one role per employer, dedupe per
designer across all searches (`JobAlertLog`), one email per designer per
run, stop link pauses everything. A lapsed member's searches pause with
`pausedReason: not_member` and resume on the next run after they return.

**Blocked on db-community for self-serve unlock.** Until it ships
`/api/members/check` (and `/api/members/active-hashes` for the lapse recheck;
see `custom-alerts-contract.md`) and `MEMBERS_API_URL`/`MEMBERS_KEY` are set on
Vercel, no subscriber can unlock on their own: the page reports the list as
unreachable. The recorded status only holds what a live check or `mode: "grant"`
wrote. Hand grants are the only path today.

Verified end to end 2026-09-21 on the preview row: sign-in form, unlock,
mismatch state, save, dry run, one real send, pause metadata.
