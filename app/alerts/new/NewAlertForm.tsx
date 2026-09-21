"use client";

import { useState } from "react";
import { saveJobAlert } from "./actions";
import { PRIMARY_ROLES, EXPERIENCE_LEVELS, ROLE_TYPES } from "@/lib/utils";
import type { Criteria } from "@/lib/job-criteria";

const LABEL = "font-mono text-[11px] font-medium uppercase tracking-[0.12em]";
const INPUT = "h-10 px-3 text-[14px] w-full focus-visible:outline-2 focus-visible:outline-[#FF4725] focus-visible:outline-offset-2";
const BOX = { border: "1px solid var(--input-border)", background: "var(--surface-1)", color: "var(--text-1)" };

function Chips({ name, options, selected }: { name: string; options: readonly string[]; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o} className="inline-flex items-center gap-2 px-3 h-9 text-[14px] cursor-pointer has-[:checked]:bg-[var(--surface-2)]" style={BOX}>
          <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="accent-[#FF4725]" />
          {o.replace(/\s*\(.*\)/, "")}
        </label>
      ))}
    </div>
  );
}

export function NewAlertForm({ token, criteria, defaultName, existingCount, max }: {
  token: string;
  criteria: Criteria;
  defaultName: string;
  existingCount: number;
  max: number;
}) {
  const [remote, setRemote] = useState<string>(criteria.remote === undefined ? "" : String(criteria.remote));

  return (
    <form action={saveJobAlert} className="flex flex-col gap-7">
      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="alert-name" className={LABEL} style={{ color: "var(--text-3)" }}>Name this search</label>
        <input id="alert-name" name="name" defaultValue={defaultName} maxLength={80} className={INPUT} style={BOX} />
        <p className="text-[14px]" style={{ color: "var(--text-3)" }}>It's the subject line of your email. {existingCount} of {max} saved searches used.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${LABEL} mb-2`} style={{ color: "var(--text-3)" }}>Role</legend>
        <Chips name="role" options={PRIMARY_ROLES} selected={criteria.role ?? []} />
        <label className="inline-flex items-center gap-2 px-3 h-9 text-[14px] cursor-pointer self-start has-[:checked]:bg-[var(--surface-2)]" style={BOX}>
          <input type="checkbox" name="leadership" value="true" defaultChecked={criteria.leadership === true} className="accent-[#FF4725]" />
          Leadership roles only (Head of, Director, VP, design manager)
        </label>
      </fieldset>

      <fieldset>
        <legend className={`${LABEL} mb-2`} style={{ color: "var(--text-3)" }}>Experience</legend>
        <Chips name="level" options={EXPERIENCE_LEVELS} selected={criteria.level ?? []} />
      </fieldset>

      <fieldset>
        <legend className={`${LABEL} mb-2`} style={{ color: "var(--text-3)" }}>Type</legend>
        <Chips name="type" options={ROLE_TYPES} selected={criteria.type ?? []} />
      </fieldset>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="alert-remote" className={LABEL} style={{ color: "var(--text-3)" }}>Remote</label>
          <select id="alert-remote" name="remote" value={remote} onChange={(e) => setRemote(e.target.value)} className={INPUT} style={BOX}>
            <option value="">Either</option>
            <option value="true">Remote only</option>
            <option value="false">On-site or hybrid only</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="alert-location" className={LABEL} style={{ color: "var(--text-3)" }}>Location contains</label>
          <input id="alert-location" name="location" defaultValue={criteria.location ?? ""} placeholder="e.g. London, New York, Canada" className={INPUT} style={BOX} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="alert-company" className={LABEL} style={{ color: "var(--text-3)" }}>Companies (comma separated)</label>
          <input id="alert-company" name="company" defaultValue={criteria.company?.join(", ") ?? ""} placeholder="e.g. Figma, Stripe" className={INPUT} style={BOX} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="alert-q" className={LABEL} style={{ color: "var(--text-3)" }}>Keyword in title or description</label>
          <input id="alert-q" name="q" defaultValue={criteria.q ?? ""} placeholder="e.g. design systems, fintech" className={INPUT} style={BOX} />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${LABEL} mb-2`} style={{ color: "var(--text-3)" }}>Pay</legend>
        <label className="inline-flex items-center gap-2 px-3 h-9 text-[14px] cursor-pointer self-start has-[:checked]:bg-[var(--surface-2)]" style={BOX}>
          <input type="checkbox" name="salary" value="true" defaultChecked={criteria.salary === true} className="accent-[#FF4725]" />
          Only roles that list pay
        </label>
        <div className="flex flex-col gap-1.5 sm:w-1/2">
          <label htmlFor="alert-salary-min" className={LABEL} style={{ color: "var(--text-3)" }}>Annual floor (roles whose listed range reaches it)</label>
          <input id="alert-salary-min" name="salaryMin" type="number" min={0} step={5000} defaultValue={criteria.salaryMin ?? ""} placeholder="e.g. 150000" className={INPUT} style={BOX} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${LABEL} mb-2`} style={{ color: "var(--text-3)" }}>How often</legend>
        {[
          ["DAILY", "Every weekday morning", "Roles land the morning after they're posted."],
          ["WEEKLY", "Weekly", ""],
          ["BIWEEKLY", "Every two weeks", ""],
        ].map(([v, l, hint]) => (
          <label key={v} className="flex items-start gap-3 px-4 py-3 cursor-pointer has-[:checked]:bg-[var(--surface-2)]" style={BOX}>
            <input type="radio" name="frequency" value={v} defaultChecked={v === "WEEKLY"} className="mt-1 accent-[#FF4725]" />
            <span>
              <span className="block text-[16px] font-medium">{l}</span>
              {hint && <span className="block text-[14px] mt-0.5" style={{ color: "var(--text-3)" }}>{hint}</span>}
            </span>
          </label>
        ))}
        <p className="text-[14px] mt-1" style={{ color: "var(--text-3)" }}>
          We send only when at least three new roles match. A quiet week means no email, and your alert page shows when the last one went out.
        </p>
      </fieldset>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <button type="submit" className="inline-flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.12em] px-6 py-3.5 rounded-md" style={{ background: "#0A0A0A", color: "#F5F2EC" }}>
          Save this search
        </button>
        <span className="text-[14px]" style={{ color: "var(--text-3)" }}>You can pause or delete it any time from your alerts page.</span>
      </div>
    </form>
  );
}
