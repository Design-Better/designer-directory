import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { parseCriteria, describeCriteria, criteriaToQuery } from "@/lib/job-criteria";
import { checkMember, isMember, memberRoster } from "@/lib/membership";
import { NewAlertForm } from "./NewAlertForm";
import { requestAlertLink, addMemberEmail, MAX_SAVED_SEARCHES } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Email me these jobs",
  description: "Save a search on the Design Better Careers board and get matching roles by email. A benefit for Design Better subscribers.",
  robots: { index: false, follow: true },
};

/** Where a non-member goes to become one. Confirm the URL with Aarron. */
const SUBSCRIBE_URL = "https://designbetterpodcast.com/subscribe?utm_source=designbetter.careers&utm_medium=alerts";

const LABEL = "font-mono text-[11px] font-medium uppercase tracking-[0.12em]";
const INPUT = "h-10 px-3 text-[14px] w-full focus-visible:outline-2 focus-visible:outline-[#FF4725] focus-visible:outline-offset-2";
const BOX = { border: "1px solid var(--input-border)", background: "var(--surface-1)", color: "var(--text-1)" };
const CTA = "inline-flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.12em] px-6 py-3.5 rounded-md";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        <p className={LABEL} style={{ color: "var(--text-3)" }}>Design Better Careers</p>
        {children}
      </div>
    </div>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-display text-display-md font-bold leading-none mt-3" style={{ color: "var(--text-1)" }}>
      {children}<span style={{ color: "#FF4725" }}>.</span>
    </h1>
  );
}

/**
 * /alerts/new?<criteria>            unidentified: ask for an email, send a link
 * /alerts/new?token=…&<criteria>    identified: membership check, then the form
 *
 * The criteria travel in the query string in the /api/v1/jobs vocabulary, so
 * a filtered board URL on designbetter.com or /jobs here is the alert.
 */
export default async function NewAlertPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const token = sp.get("token") ?? "";
  const criteria = parseCriteria(sp);
  const qs = criteriaToQuery(criteria);
  const label = describeCriteria(criteria);

  // --- Unidentified visitor -------------------------------------------------
  const designer = token ? await db.designer.findUnique({ where: { editToken: token }, include: { _count: { select: { jobAlerts: true } } } }) : null;
  if (!designer) {
    if (sp.get("sent") === "1") {
      return (
        <Shell>
          <H1>Check your email</H1>
          <p className="text-[16px] leading-relaxed mt-5" style={{ color: "var(--text-2)" }}>
            If that address is yours, a sign-in link is on its way. Click it to finish setting up <strong>{label}</strong>. Nothing is saved until you do.
          </p>
        </Shell>
      );
    }
    return (
      <Shell>
        <H1>Email me these jobs</H1>
        <p className="text-[16px] leading-relaxed mt-5" style={{ color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text-1)" }}>{label}</strong>, delivered as new roles are posted. Saved searches are a benefit for Design Better subscribers; we&apos;ll check your subscription after you sign in. A directory profile is optional.
        </p>
        <form action={requestAlertLink} className="mt-8 flex flex-col gap-4">
          <input type="hidden" name="criteria" value={qs} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className={LABEL} style={{ color: "var(--text-3)" }}>Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className={INPUT} style={BOX} />
              {sp.get("error") === "email" && <p className="text-[14px]" style={{ color: "var(--book-fg)" }}>That doesn&apos;t look like an email address.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="firstName" className={LABEL} style={{ color: "var(--text-3)" }}>First name (optional)</label>
              <input id="firstName" name="firstName" autoComplete="given-name" className={INPUT} style={BOX} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <button type="submit" className={CTA} style={{ background: "#0A0A0A", color: "#F5F2EC" }}>Send me a sign-in link</button>
            <span className="text-[14px]" style={{ color: "var(--text-3)" }}>We&apos;ll email a link; no password.</span>
          </div>
        </form>
        <p className="text-[14px] mt-8" style={{ color: "var(--text-3)" }}>
          Not a subscriber? Profile-based alerts are free for everyone: <Link href="/join" className="underline" style={{ color: "var(--text-1)" }}>create a profile</Link> and choose a cadence.
        </p>
      </Shell>
    );
  }

  // --- Identified: membership -----------------------------------------------
  const roster = await memberRoster();
  let entitled = isMember(designer, roster);
  if (!entitled && !designer.memberCheckedAt) {
    // First visit: one live check on the sign-in address, recorded if it passes.
    const c = await checkMember(designer.email);
    if (c.entitled) {
      await db.designer.update({ where: { id: designer.id }, data: { memberStatus: c.status, memberCheckedAt: new Date() } });
      entitled = true;
    } else {
      await db.designer.update({ where: { id: designer.id }, data: { memberStatus: "none", memberCheckedAt: new Date() } });
    }
  }

  if (!entitled) {
    const state = sp.get("member");
    return (
      <Shell>
        <H1>One more step</H1>
        <p className="text-[16px] leading-relaxed mt-5" style={{ color: "var(--text-2)" }}>
          Saved searches are a benefit for paying Design Better subscribers. We couldn&apos;t find a subscription under <strong style={{ color: "var(--text-1)" }}>{designer.email}</strong>
          {designer.memberEmail ? <> or <strong style={{ color: "var(--text-1)" }}>{designer.memberEmail}</strong></> : null}.
          {" "}Many people subscribe with a different address than the one they use for work.
        </p>
        <form action={addMemberEmail} className="mt-8 flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="criteria" value={qs} />
          <div className="flex flex-col gap-1.5 sm:w-2/3">
            <label htmlFor="memberEmail" className={LABEL} style={{ color: "var(--text-3)" }}>The email you subscribe with</label>
            <input id="memberEmail" name="memberEmail" type="email" required className={INPUT} style={BOX} />
            {state === "notfound" && <p className="text-[14px]" style={{ color: "var(--book-fg)" }}>No active subscription under that address either.</p>}
            {state === "invalid" && <p className="text-[14px]" style={{ color: "var(--book-fg)" }}>That doesn&apos;t look like an email address.</p>}
            {state === "unavailable" && <p className="text-[14px]" style={{ color: "var(--book-fg)" }}>We couldn&apos;t reach the subscription list just now. Try again in a few minutes.</p>}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <button type="submit" className={CTA} style={{ background: "#0A0A0A", color: "#F5F2EC" }}>Check that address</button>
            <a href={SUBSCRIBE_URL} className={CTA} style={{ border: "1px solid var(--input-border)", color: "var(--text-1)" }}>Subscribe to Design Better</a>
          </div>
        </form>
        <p className="text-[14px] mt-8" style={{ color: "var(--text-3)" }}>
          Meanwhile, profile-based alerts are free: <Link href={`/alerts?token=${token}`} className="underline" style={{ color: "var(--text-1)" }}>set a cadence</Link> and we&apos;ll match roles to your profile.
        </p>
      </Shell>
    );
  }

  // --- Entitled: the form ---------------------------------------------------
  if (designer._count.jobAlerts >= MAX_SAVED_SEARCHES) {
    return (
      <Shell>
        <H1>You have {MAX_SAVED_SEARCHES} saved searches</H1>
        <p className="text-[16px] leading-relaxed mt-5" style={{ color: "var(--text-2)" }}>
          That&apos;s the limit. Delete or merge one on your <Link href={`/alerts?token=${token}`} className="underline" style={{ color: "var(--text-1)" }}>alerts page</Link>, then come back.
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <H1>Save this search</H1>
      <p className="text-[16px] leading-relaxed mt-5 mb-8" style={{ color: "var(--text-2)" }}>
        Adjust anything, pick how often, and we&apos;ll email new roles that match. Hi {designer.firstName === "there" ? "there" : designer.firstName}, you&apos;re signed in as {designer.email}.
      </p>
      <NewAlertForm token={token} criteria={criteria} defaultName={label} existingCount={designer._count.jobAlerts} max={MAX_SAVED_SEARCHES} />
    </Shell>
  );
}
