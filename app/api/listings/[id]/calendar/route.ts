import { listing } from "@/market/repo";
import { monthDays } from "@/market/calendar";
import { db } from "@/server/db";
import { json, limited } from "@/server/api";

/** Month grid for the date picker: each night's price tier, and which nights are taken. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = limited(req, "calendar", 120);
  if (block) return block;
  const d = db();
  const l = listing(d, Number((await params).id));
  if (!l || l.status !== "live") return json({ error: "NOT_FOUND" }, 404);
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "BAD_REQUEST" }, 400);
  return json({ month, days: monthDays(d, l.id, month) });
}
