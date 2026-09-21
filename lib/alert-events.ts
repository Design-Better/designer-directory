import { db } from "@/lib/db";

export type AlertEventKind = "invite_click" | "prefs_saved" | "stop" | "job_view" | "apply_click" | "custom_request" | "custom_saved";

/**
 * Fire-and-forget funnel logging for designer emails. Never throws and never
 * awaits the DB on the request path: a logging failure must not break a page
 * a designer just clicked through to from an email.
 */
export function logAlertEvent(e: {
  kind: AlertEventKind;
  designerId?: string | null;
  jobId?: string | null;
  source?: string | null;
  detail?: string | null;
}): void {
  db.alertEvent
    .create({
      data: {
        kind: e.kind,
        designerId: e.designerId ?? null,
        jobId: e.jobId ?? null,
        source: e.source ?? null,
        detail: e.detail ?? null,
      },
    })
    .catch(() => { /* logging is best-effort */ });
}

/** Distinct designers and total events per kind, optionally since a date. */
export async function alertFunnel(opts: { since?: Date; excludeDesignerIds?: string[] } = {}) {
  const rows = await db.alertEvent.findMany({
    where: {
      ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
      ...(opts.excludeDesignerIds?.length ? { OR: [{ designerId: null }, { designerId: { notIn: opts.excludeDesignerIds } }] } : {}),
    },
    select: { kind: true, designerId: true, jobId: true, source: true, detail: true },
  });
  const byKind: Record<string, { events: number; designers: number; jobs: number }> = {};
  const seenD: Record<string, Set<string>> = {};
  const seenJ: Record<string, Set<string>> = {};
  for (const r of rows) {
    byKind[r.kind] ??= { events: 0, designers: 0, jobs: 0 };
    byKind[r.kind].events++;
    if (r.designerId) (seenD[r.kind] ??= new Set()).add(r.designerId);
    if (r.jobId) (seenJ[r.kind] ??= new Set()).add(r.jobId);
  }
  for (const k of Object.keys(byKind)) {
    byKind[k].designers = seenD[k]?.size ?? 0;
    byKind[k].jobs = seenJ[k]?.size ?? 0;
  }
  const prefs: Record<string, number> = {};
  for (const r of rows) if (r.kind === "prefs_saved" && r.detail) prefs[r.detail] = (prefs[r.detail] ?? 0) + 1;
  return { byKind, prefsBreakdown: prefs };
}
