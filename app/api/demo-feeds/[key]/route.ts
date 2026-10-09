import { demoFeed } from "@/market/ical";
import { db } from "@/server/db";

/** Stand-in for an Airbnb export feed in the demo (editable from /admin/demo-feed). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.replace(/\.ics$/, "");
  return new Response(demoFeed(db(), key), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}
