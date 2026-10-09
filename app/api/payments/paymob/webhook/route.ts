import { handlePaymobCallback } from "@/market/payment-webhook";
import { db } from "@/server/db";
import { json } from "@/server/api";

/** Paymob transaction callback: the only path that confirms a booking. */
export async function POST(req: Request) {
  const hmac = new URL(req.url).searchParams.get("hmac");
  const out = await handlePaymobCallback(db(), await req.json().catch(() => null), hmac);
  return json({ result: out.result }, out.status);
}
