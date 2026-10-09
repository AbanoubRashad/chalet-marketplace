import { NextResponse } from "next/server";
import { MarketError } from "@/market/booking";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(err: unknown) {
  if (err instanceof MarketError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "DATES_TAKEN" ? 409 : err.code === "HOLD_EXPIRED" ? 410 : err.code === "FORBIDDEN" ? 403 : 422;
    return json({ error: err.code, detail: err.message !== err.code ? err.message : undefined }, status);
  }
  console.error(err);
  return json({ error: "generic" }, 500);
}

export function limited(req: Request, bucket: string, limit: number, windowMs = 60_000) {
  const r = rateLimit(`${bucket}:${clientIp(req.headers)}`, limit, windowMs);
  return r.ok ? null : json({ error: "RATE_LIMITED" }, 429, { "Retry-After": String(r.retryAfter) });
}

export function originOf(h: Headers) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
