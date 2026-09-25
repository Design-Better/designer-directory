"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { JOB_POSTING_PRICE_DOLLARS } from "@/lib/stripe";

/** Header styled to match designbetter.com; classes live in app/globals.css (db-header*). */
export function HeaderNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";

  const links = [
    { href: "/", label: "Jobs", current: pathname === "/" || pathname.startsWith("/jobs") },
    { href: "/talent", label: "Designers", current: pathname.startsWith("/talent") },
  ];

  return (
    <header className="db-header">
      <div className="db-header-row">
        <Link href="/" className="db-logo" aria-label="Design Better Careers home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/DesignBetterWhite.svg" alt="Design Better" width={78} height={42} />
        </Link>

        <nav className="db-nav" aria-label="Sections">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <Link href="/post-a-job" className="db-cta">
          Post a Job — ${JOB_POSTING_PRICE_DOLLARS}
        </Link>

        <button
          type="button"
          className="db-menu-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="db-menu"
        >
          {open ? <X className="w-5 h-5" aria-hidden /> : <Menu className="w-5 h-5" aria-hidden />}
          <span className="sr-only">Menu</span>
        </button>
      </div>

      <nav id="db-menu" className="db-menu" aria-label="All sections" hidden={!open}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
