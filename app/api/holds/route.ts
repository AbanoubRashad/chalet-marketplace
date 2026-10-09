import { all } from "@/lib/db";
import { createHold } from "@/market/booking";
import { syncFeed } from "@/market/ical";
import { audit, settings, SYSTEM } from "@/market/repo";
import { db } from "@/server/db";
import { errorResponse, json, limited } from "@/server/api";

/**
 * Hold dates while the guest fills details and pays. Before accepting, refresh this listing's
 * imported calendars if older than 5 minutes; a failing feed is reported to admins as stale.
 */
export async function POST(req: Request) {
  const block = limited(req, "hold", 10);
  if (block) return block;
  const body = (await req.json().catch(() => null)) as { listingId?: number; checkIn?: string; checkOut?: string; guests?: number } | null;
  if (!body || !Number.isInteger(body.listingId) || typeof body.checkIn !== "string" || typeof body.checkOut !== "string") return json({ error: "BAD_REQUEST" }, 400);
  const d = db();
  const s = settings(d);
  const now = new Date();
  for (const f of all<{ id: number; last_sync_at: string | null }>(d, "SELECT id, last_sync_at FROM ical_feeds WHERE listing_id = ?", body.listingId!)) {
    if (!f.last_sync_at || Date.parse(f.last_sync_at) < now.getTime() - 5 * 60_000) {
      const r = await syncFeed(d, f.id, now);
      if (r.error) audit(d, SYSTEM, "ical.stale_on_booking", "ical_feed", f.id, null, { error: r.error, staleMinutes: s.ical_stale_minutes });
    }
  }
  try {
    const b = createHold(d, { listingId: body.listingId!, checkIn: body.checkIn, checkOut: body.checkOut, guests: Number(body.guests) || 1 }, now);
    return json({ token: b.public_token, expiresAt: b.hold_expires_at }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
