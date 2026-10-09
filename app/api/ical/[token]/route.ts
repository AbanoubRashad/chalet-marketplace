import { get } from "@/lib/db";
import { exportIcal, verifyExportToken } from "@/market/ical";
import { db } from "@/server/db";

/** Secret, signed export URL that owners paste into Airbnb / Booking.com. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = verifyExportToken((await params).token);
  const l = raw ? get<{ id: number }>(db(), "SELECT id FROM listings WHERE ical_export_token = ?", raw) : undefined;
  if (!l) return new Response("Not found", { status: 404 });
  return new Response(exportIcal(db(), l.id), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}
