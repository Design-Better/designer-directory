import Link from "next/link";
import { db } from "@/lib/db";
import { AlertsForm } from "./AlertsForm";
import { pickMatches, toDesignerForMatching, CADENCE_LABEL, MIN_MATCHES } from "@/lib/job-alerts";
import { logAlertEvent } from "@/lib/alert-events";
import { describeCriteria, parseCriteria } from "@/lib/job-criteria";
import { setAlertPaused, deleteJobAlert } from "./new/actions";

export const dynamic = "force-dynamic";

interface SearchParams {
  token?: string;
  stop?: string;
  saved?: string;
  status?: string;
  error?: string;
  limit?: string;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">{children}</div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="font-display text-display-md font-bold leading-none" style={{ color: "var(--text-1)" }}>
        {title}<span style={{ color: "#FF4725" }}>.</span>
      </h1>
      <div className="text-[16px] leading-relaxed mt-5 flex flex-col gap-3" style={{ color: "var(--text-2)" }}>{children}</div>
    </>
  );
}

const CTA = "inline-flex items-center font-mono text-[11px] font-normal uppercase tracking-[0.12em] px-5 py-3 rounded-md transition-colors duration-[120ms]";

/**
 * Reached only by the editToken in an email, so no login. One page does the
 * check-in, the cadence choice and the profile refresh; ?stop=1 is the
 * one-click unsubscribe from every alert footer.
 */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const token = params.token ?? "";

  const designer = token ? await db.designer.findUnique({ where: { editToken: token } }) : null;
  if (!designer) {
    return (
      <Shell>
        <Notice title="That link didn't work">
          <p>Alert links are personal and come from an email we sent you. Open the most recent one and use the link there.</p>
          <p>No profile yet? <Link href="/join" className="underline" style={{ color: "var(--text-1)" }}>Join the directory</Link>.</p>
        </Notice>
      </Shell>
    );
  }

  const editUrl = `/profile/edit?token=${encodeURIComponent(token)}`;
  const alertsUrl = `/alerts?token=${encodeURIComponent(token)}`;

  if (params.stop === "1") {
    if (designer.alertFrequency !== "NONE") {
      await db.designer.update({ where: { id: designer.id }, data: { alertFrequency: "NONE" } });
    }
    await db.jobAlert.updateMany({ where: { designerId: designer.id, pausedAt: null }, data: { pausedAt: new Date(), pausedReason: "user" } });
    logAlertEvent({ kind: "stop", designerId: designer.id });
    return (
      <Shell>
        <Notice title="Alerts stopped">
          <p>You won't get job emails from us. Your profile is unchanged and still visible to employers.</p>
          <p className="mt-2 flex flex-wrap gap-3">
            <Link href={alertsUrl} className={CTA} style={{ background: "#0A0A0A", color: "#F5F2EC" }}>Turn alerts back on</Link>
            <Link href={editUrl} className={CTA} style={{ border: "1px solid var(--input-border)", color: "var(--text-1)" }}>Update my profile</Link>
          </p>
        </Notice>
      </Shell>
    );
  }

  if (params.saved === "1") {
    if (designer.openToWork === "NOT_LOOKING") {
      return (
        <Shell>
          <Notice title="Profile paused">
            <p>Congratulations on the new role, {designer.firstName}. Your profile is hidden from employers and we won't email you about jobs.</p>
            <p>If things change, any past email from us has a link that brings you back here.</p>
          </Notice>
        </Shell>
      );
    }
    const pool = await db.job.findMany({ where: { active: true, createdAt: { gte: new Date(Date.now() - 14 * 864e5) } } });
    const matching = pickMatches(toDesignerForMatching(designer), pool).length;
    const on = designer.alertFrequency !== "NONE";
    return (
      <Shell>
        <Notice title="You're set">
          <p>
            {on
              ? `${CADENCE_LABEL[designer.alertFrequency]} it is. Your first email arrives next Tuesday.`
              : "Your profile is confirmed and visible. No job emails, as you asked."}
            {" "}Right now {matching >= MIN_MATCHES ? `${matching} roles from the last two weeks match your profile` : "fewer than three recent roles match your profile, so we'd wait for a better week rather than send a thin list"}.
          </p>
          <p>While your details are fresh in mind, the rest of your profile is what employers actually read.</p>
          <p className="mt-2 flex flex-wrap gap-3">
            <Link href={editUrl} className={CTA} style={{ background: "#0A0A0A", color: "#F5F2EC" }}>Update my profile</Link>
            <Link href="/jobs" className={CTA} style={{ border: "1px solid var(--input-border)", color: "var(--text-1)" }}>Browse open roles</Link>
          </p>
        </Notice>
      </Shell>
    );
  }

  // Reaching this page with a valid token means an email link was clicked.
  logAlertEvent({ kind: "invite_click", designerId: designer.id });

  const savedSearches = await db.jobAlert.findMany({ where: { designerId: designer.id }, orderBy: { createdAt: "asc" } });
  const justSaved = params.saved && params.saved !== "1" ? params.saved : null;

  return (
    <Shell>
      {(savedSearches.length > 0 || justSaved) && (
        <section className="mb-12 pb-10" style={{ borderBottom: "1px solid var(--divider)" }}>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>Saved searches · Design Better subscriber benefit</p>
          {justSaved && (
            <p className="text-[16px] leading-relaxed mt-3" style={{ color: "var(--text-1)" }}>
              Saved. The first email goes out on the next weekday morning that three or more new roles match.
            </p>
          )}
          <ul className="mt-4 flex flex-col gap-2">
            {savedSearches.map((a) => {
              const c = parseCriteria(a.criteria as Record<string, unknown>);
              const paused = Boolean(a.pausedAt);
              return (
                <li key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3" style={{ border: "1px solid var(--input-border)", background: "var(--surface-1)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-medium" style={{ color: "var(--text-1)" }}>{a.name}</p>
                    <p className="text-[14px] mt-0.5" style={{ color: "var(--text-3)" }}>
                      {describeCriteria(c)} · {CADENCE_LABEL[a.frequency]}
                      {paused ? ` · paused${a.pausedReason === "not_member" ? " (subscription not found)" : ""}` : a.lastSentAt ? ` · last sent ${a.lastSentAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : " · nothing sent yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <form action={setAlertPaused}>
                      <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="paused" value={paused ? "0" : "1"} />
                      <button type="submit" className={CTA} style={{ border: "1px solid var(--input-border)", color: "var(--text-1)" }}>{paused ? "Resume" : "Pause"}</button>
                    </form>
                    <form action={deleteJobAlert}>
                      <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={a.id} />
                      <button type="submit" className={CTA} style={{ color: "var(--text-3)" }}>Delete</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[14px]" style={{ color: "var(--text-3)" }}>
            <Link href={`/alerts/new?token=${token}`} className="underline" style={{ color: "var(--text-1)" }}>Add another saved search</Link>
            {params.limit === "1" ? " · you\u2019re at the limit of five; delete one first." : ""}
          </p>
        </section>
      )}
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>Design Better Careers</p>
      <h1 className="font-display text-display-md font-bold leading-none mt-3" style={{ color: "var(--text-1)" }}>
        Hi {designer.firstName}<span style={{ color: "#FF4725" }}>.</span>
      </h1>
      <p className="text-[16px] leading-relaxed mt-5" style={{ color: "var(--text-2)" }}>
        Tell us what types of roles you're looking for and how often you want to be notified.
      </p>
      <AlertsForm
        token={token}
        initialStatus={params.status === "NOT_LOOKING" ? "NOT_LOOKING" : undefined}
        designer={{
          firstName: designer.firstName,
          primaryRole: designer.primaryRole,
          experienceLevel: designer.experienceLevel,
          location: designer.location,
          remotePreference: designer.remotePreference,
          typeOfRole: designer.typeOfRole,
          openToWork: designer.openToWork,
          alertFrequency: designer.alertFrequency,
          wantsLeadership: designer.wantsLeadership,
        }}
      />
    </Shell>
  );
}
