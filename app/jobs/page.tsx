import type { Metadata } from "next";
import { JobsBoard, jobsBoardMetadata, type SearchParams } from "@/components/JobsBoard";

/**
 * /jobs is the same board as the home page. It stays because hundreds of
 * links point here: alert emails, the API's `url` fields, the sitemap, the
 * employer views (?company=), and designbetter.com's filter row.
 */
export const dynamic = "force-dynamic";

const DECK = "Find your next role and a new chapter in your design career.";

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  return jobsBoardMetadata(searchParams, DECK);
}

export default function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <JobsBoard searchParams={searchParams} basePath="/jobs" title="Design Jobs" deck={DECK} />;
}
