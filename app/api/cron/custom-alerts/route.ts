import { NextRequest, NextResponse } from "next/server";
import { sendCustomAlerts } from "@/lib/job-alerts";

export const maxDuration = 300;

/**
 * Weekdays 08:00 UTC (vercel.json), an hour after the daily ingest. Cadence is
 * enforced per saved search inside sendCustomAlerts, so one daily run serves
 * daily, weekly and biweekly alerts alike, and membership is re-checked on
 * every run.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendCustomAlerts();
  return NextResponse.json({ ok: true, ...result, samples: undefined });
}
