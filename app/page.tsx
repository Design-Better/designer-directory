import type { Metadata } from "next";
import { JobsBoard, jobsBoardMetadata, type SearchParams } from "@/components/JobsBoard";

/**
 * The home page is the job board. No hero, no directory pitch: the roles are
 * the point, and the nav carries the rest.
 */
export const dynamic = "force-dynamic";

const DECK = "Find your next role and a new chapter in your design career.";

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  return jobsBoardMetadata(searchParams, DECK);
}

export default function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <JobsBoard searchParams={searchParams} basePath="/" title="Design Jobs" deck={DECK} />;
}
