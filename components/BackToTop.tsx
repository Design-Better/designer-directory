"use client";

import { ArrowUp } from "lucide-react";

/** Scrolls to the top and returns keyboard focus to the header, so the jump is not disorienting. */
export function BackToTop() {
  function go() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    document.querySelector<HTMLElement>("header a")?.focus({ preventScroll: true });
  }
  return (
    <button type="button" className="db-totop" onClick={go}>
      <ArrowUp className="w-3.5 h-3.5" aria-hidden />
      Back to top
    </button>
  );
}
