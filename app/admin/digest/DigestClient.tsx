"use client";

import { useMemo, useState } from "react";
import { Check, Copy, FileText, Sparkles, RefreshCw } from "lucide-react";
import { markDigested } from "./actions";

export type DigestJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  typeOfRole: string;
  compensation: string | null;
  createdAt: string;
  role: string;
  leadership: boolean;
  /** Digest score and the reasons it earned; jobs arrive sorted by rank. */
  score: number;
  reasons: string[];
  digestedAt: string | null;
};

const PICK_COUNT = 5;

function buildMeta(job: DigestJob): string {
  return [job.typeOfRole, job.location, job.remote ? "Remote OK" : null, job.compensation ?? null]
    .filter(Boolean)
    .join(" · ");
}

function generateSubstackHtml(jobs: DigestJob[], appUrl: string): string {
  return jobs
    .map((job) => {
      const meta = buildMeta(job);
      return `<p><strong><a href="${appUrl}/jobs/${job.id}">${job.title}</a></strong> at ${job.company}<br>${meta}</p>`;
    })
    .join("\n");
}

function generatePlainText(jobs: DigestJob[], appUrl: string): string {
  return jobs
    .map((job) => `${job.title} at ${job.company}\n${buildMeta(job)}\n${appUrl}/jobs/${job.id}`)
    .join("\n\n");
}

export function DigestClient({ jobs, appUrl }: { jobs: DigestJob[]; appUrl: string }) {
  // Jobs arrive ranked; the first five are the suggestion. "Next 5" walks down
  // the same list, so a fresh set costs no server round trip.
  const [suggestOffset, setSuggestOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(jobs.slice(0, PICK_COUNT).map((j) => j.id)),
  );
  const [copied, setCopied] = useState<null | "substack" | "text">(null);
  const [marked, setMarked] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const selectedJobs = useMemo(
    // Keep newsletter order = rank order, whatever order boxes were ticked in.
    () => jobs.filter((j) => selectedIds.has(j.id)),
    [jobs, selectedIds],
  );
  const suggestedIds = useMemo(
    () => new Set(jobs.slice(suggestOffset, suggestOffset + PICK_COUNT).map((j) => j.id)),
    [jobs, suggestOffset],
  );
  const canSuggestMore = suggestOffset + PICK_COUNT < jobs.length;
  const visibleJobs = showAll ? jobs : jobs.slice(0, Math.max(25, suggestOffset + PICK_COUNT + 5));

  function toggleJob(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function suggest(offset: number) {
    setSuggestOffset(offset);
    setSelectedIds(new Set(jobs.slice(offset, offset + PICK_COUNT).map((j) => j.id)));
    setMarked(null);
  }

  async function afterCopy(kind: "substack" | "text") {
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
    try {
      const r = await markDigested(selectedJobs.map((j) => j.id));
      setMarked(r.marked);
    } catch { /* copying still worked; marking is bookkeeping */ }
  }

  async function copyForSubstack() {
    const html = generateSubstackHtml(selectedJobs, appUrl);
    const plain = generatePlainText(selectedJobs, appUrl);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }
    await afterCopy("substack");
  }

  async function copyPlainText() {
    await navigator.clipboard.writeText(generatePlainText(selectedJobs, appUrl));
    await afterCopy("text");
  }

  return (
    <div className="space-y-8">
      {/* Suggestion controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-gray-100 bg-brand-gray-50 px-4 py-3">
        <Sparkles className="w-4 h-4 text-brand-red flex-shrink-0" />
        <p className="text-sm text-brand-black flex-1 min-w-[12rem]">
          <span className="font-semibold">Top {PICK_COUNT} selected.</span>{" "}
          <span className="text-brand-gray-500">
            Ranked on pay listed, remote, seniority, a full description, curated employers and recency; one employer each, a leadership role in the mix.
          </span>
        </p>
        <div className="flex items-center gap-2">
          {suggestOffset > 0 && (
            <button onClick={() => suggest(0)} className="text-xs text-brand-gray-500 hover:text-brand-black transition-colors">
              Back to top 5
            </button>
          )}
          <button
            onClick={() => suggest(suggestOffset + PICK_COUNT)}
            disabled={!canSuggestMore}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-gray-200 bg-white text-brand-black text-xs font-bold uppercase tracking-widest rounded hover:border-brand-black transition-colors disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" /> Next 5
          </button>
        </div>
      </div>

      {/* Job list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-brand-black">
            Jobs, best first{" "}
            <span className="font-normal text-brand-gray-400">({selectedIds.size} selected)</span>
          </h2>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-brand-gray-400 hover:text-brand-black transition-colors">
            Clear selection
          </button>
        </div>

        <div className="divide-y divide-brand-gray-100 border border-brand-gray-100 rounded-xl overflow-hidden">
          {visibleJobs.map((job, i) => {
            const isSuggested = suggestedIds.has(job.id);
            return (
              <label
                key={job.id}
                className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${isSuggested ? "bg-[#FFF3EF] hover:bg-[#FFE9E2]" : "bg-white hover:bg-brand-gray-50"}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(job.id)}
                  onChange={() => toggleJob(job.id)}
                  className="mt-0.5 accent-brand-red flex-shrink-0"
                />
                <span className="w-6 text-[10px] font-mono text-brand-gray-300 mt-0.5 flex-shrink-0 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-brand-black">
                    {job.title} <span className="font-normal text-brand-gray-500">at {job.company}</span>
                  </p>
                  <p className="text-xs text-brand-gray-500 mt-0.5">{buildMeta(job)}</p>
                  {job.reasons.length > 0 && (
                    <p className="text-[10px] uppercase tracking-widest mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      {job.reasons.map((r) => (
                        <span key={r} className={r === "flagged" ? "text-brand-red" : "text-brand-gray-400"}>{r}</span>
                      ))}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 mt-1">
                  <span className="text-[10px] uppercase tracking-widest text-brand-gray-300">
                    {new Date(job.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  {job.digestedAt && (
                    <span className="text-[9px] uppercase tracking-widest text-brand-gray-300">featured {new Date(job.digestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        {!showAll && visibleJobs.length < jobs.length && (
          <button onClick={() => setShowAll(true)} className="mt-3 text-xs text-brand-gray-500 hover:text-brand-black transition-colors">
            Show all {jobs.length} jobs
          </button>
        )}
      </div>

      {selectedJobs.length === 0 ? (
        <p className="text-sm text-brand-gray-400 text-center py-6">Select at least one job to copy.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Preview */}
          <div>
            <h2 className="text-sm font-semibold text-brand-black mb-3">Preview</h2>
            <div className="border border-brand-gray-100 rounded-xl p-5 bg-white space-y-4">
              {selectedJobs.map((job) => (
                <div key={job.id} className="border-b border-brand-gray-100 pb-4 last:border-0 last:pb-0">
                  <p className="text-sm">
                    <span className="font-bold text-brand-red underline underline-offset-2">{job.title}</span>{" "}
                    <span className="font-bold text-brand-black">at {job.company}</span>
                  </p>
                  <p className="text-xs text-brand-gray-500 mt-0.5">{buildMeta(job)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Copy options */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-brand-black">Copy options</h2>

            <div className="border border-brand-gray-100 rounded-xl p-5 bg-white">
              <p className="text-sm font-semibold text-brand-black mb-1">Copy for Substack</p>
              <p className="text-xs text-brand-gray-400 mb-4 leading-relaxed">
                Paste directly into your Substack editor. Job titles become clickable links, formatting is preserved.
              </p>
              <button
                onClick={copyForSubstack}
                className="flex items-center gap-2 px-4 py-2 bg-brand-black text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-brand-gray-800 transition-colors"
              >
                {copied === "substack" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === "substack" ? "Copied!" : "Copy for Substack"}
              </button>
            </div>

            <div className="border border-brand-gray-100 rounded-xl p-5 bg-white">
              <p className="text-sm font-semibold text-brand-black mb-1">Copy as plain text</p>
              <p className="text-xs text-brand-gray-400 mb-4 leading-relaxed">Simple text with full URLs. Works anywhere: email, Slack, notes.</p>
              <button
                onClick={copyPlainText}
                className="flex items-center gap-2 px-4 py-2 border border-brand-gray-200 text-brand-black text-xs font-bold uppercase tracking-widest rounded hover:border-brand-black transition-colors"
              >
                {copied === "text" ? <Check className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                {copied === "text" ? "Copied!" : "Copy plain text"}
              </button>
            </div>

            {marked !== null && (
              <p className="text-xs text-brand-gray-400 leading-relaxed">
                {marked > 0
                  ? `${marked} job${marked === 1 ? "" : "s"} recorded as featured. Next week they won't be suggested again.`
                  : "These were already recorded as featured."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
