import { isAvailable, quote } from "@/market/booking";
import { listing } from "@/market/repo";
import { db } from "@/server/db";
import { errorResponse, json, limited } from "@/server/api";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = limited(req, "quote", 120);
  if (block) return block;
  const d = db();
  const l = listing(d, Number((await params).id));
  if (!l || l.status !== "live") return json({ error: "NOT_FOUND" }, 404);
  const u = new URL(req.url).searchParams;
  const checkIn = u.get("in") ?? "";
  const checkOut = u.get("out") ?? "";
  try {
    const q = quote(d, l, checkIn, checkOut);
    return json({ quote: q, available: isAvailable(d, l.id, checkIn, checkOut) });
  } catch (err) {
    return errorResponse(err);
  }
}
