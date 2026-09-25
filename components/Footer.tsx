import Link from "next/link";
import { BackToTop } from "@/components/BackToTop";

/** Footer styled to match designbetter.com; classes live in app/globals.css (db-footer*). */
export function Footer() {
  return (
    <footer className="db-footer mt-24">
      <div className="db-in db-footer-top">
        <a href="https://designbetter.com" className="db-footer-home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/DesignBetterWhite.svg" alt="Design Better" width={86} height={46} loading="lazy" />
          <span>designbetter.com →</span>
        </a>
      </div>

      <div className="db-in db-footer-legal">
        <p>
          © {new Date().getFullYear()} The Curiosity Department, LLC
          {" · "}<Link href="/privacy">Privacy</Link>
          {" · "}<Link href="/terms">Terms</Link>
          {" · "}<a href="mailto:careers@thecuriositydepartment.com">Contact</a>
          {" · "}<a href="https://github.com/Design-Better/designer-directory/issues/new" target="_blank" rel="noreferrer">Report a Bug</a>
        </p>
        <BackToTop />
      </div>
    </footer>
  );
}
