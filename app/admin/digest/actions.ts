"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";

/**
 * Called when the admin copies a digest: records which jobs went out so the
 * next "suggest 5" skips them. Idempotent; already-marked rows keep their
 * original date.
 */
export async function markDigested(ids: string[]): Promise<{ marked: number }> {
  const token = (await cookies()).get("admin_token")?.value;
  if (!token || token !== process.env.ADMIN_SECRET) throw new Error("Unauthorized");
  if (!ids.length) return { marked: 0 };
  const r = await db.job.updateMany({
    where: { id: { in: ids }, digestedAt: null },
    data: { digestedAt: new Date() },
  });
  return { marked: r.count };
}
