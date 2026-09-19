import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { HeaderNav } from "@/components/HeaderNav";
import { Footer } from "@/components/Footer";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getCorpusStats, formatSubscribers } from "@/lib/corpus";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://designbetter.careers";

export async function generateMetadata(): Promise<Metadata> {
  const corpusStats = await getCorpusStats();
  const subscriberLabel = formatSubscribers(corpusStats?.subscribers) ?? "hundreds of thousands of";

  return {
    title: {
      default: "Design Better Careers — Design Jobs & Talent Directory",
      template: "%s | Design Better Careers",
    },
    description:
      `The career hub for ${subscriberLabel} design and tech professionals. Browse senior design talent or post your open role to reach the best designers.`,
    metadataBase: new URL(APP_URL.startsWith("http") ? APP_URL : `https://${APP_URL}`),
    // No canonical here: it would be inherited by every page that does not
    // override it, which once told Google that /jobs, every job page and
    // /talent were duplicates of the home page. Each page sets its own.
    openGraph: {
      title: "Design Better Careers",
      description:
        `Browse senior design talent or post your open role to reach ${subscriberLabel} design professionals.`,
      siteName: "Design Better Careers",
      type: "website",
      url: APP_URL,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "Design Better Careers — Design Jobs & Talent Directory",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Design Better Careers",
      description: `Senior design talent. Quality jobs. ${subscriberLabel} readers.`,
      images: ["/og-image.png"],
    },
  };
}

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${APP_URL}/#organization`,
      name: "Design Better Careers",
      url: APP_URL,
      logo: {
        "@type": "ImageObject",
        url: `${APP_URL}/DesignBetterCareers.png`,
      },
      sameAs: [
        "https://www.linkedin.com/company/design-better",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${APP_URL}/#website`,
      url: APP_URL,
      name: "Design Better Careers",
      publisher: { "@id": `${APP_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${APP_URL}/talent?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Aktiv Grotesk — Adobe Fonts (Design Better subscription kit) */}
        <link rel="stylesheet" href="https://use.typekit.net/pvj2wrc.css" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="flex flex-col min-h-screen font-body">
        <HeaderNav />
        <main className="flex-grow">{children}</main>
        <Footer />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
