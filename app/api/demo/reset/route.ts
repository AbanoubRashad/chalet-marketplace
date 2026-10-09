import { getDb } from "@/lib/db";
import { resetDemo, seedDemo } from "@/market/seed";

/** Daily demo refresh (Vercel Cron). Rebuilds the fictional demo data relative to today. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const db = getDb();
  resetDemo(db);
  seedDemo(db);
  return Response.json({ ok: true, at: new Date().toISOString() });
}
