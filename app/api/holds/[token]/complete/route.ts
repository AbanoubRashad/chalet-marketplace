import { completeBooking } from "@/market/booking";
import { db } from "@/server/db";
import { errorResponse, json, limited, originOf } from "@/server/api";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const block = limited(req, "complete", 10);
  if (block) return block;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || typeof body.phone !== "string" || (body.method !== "card" && body.method !== "wallet")) return json({ error: "BAD_REQUEST" }, 400);
  try {
    const r = await completeBooking(
      db(),
      (await params).token,
      {
        name: body.name,
        phone: body.phone,
        email: typeof body.email === "string" ? body.email : undefined,
        idType: body.idType === "passport" ? "passport" : body.idType === "national_id" ? "national_id" : undefined,
        idNumber: typeof body.idNumber === "string" ? body.idNumber : undefined,
        method: body.method,
      },
      { origin: originOf(req.headers) },
    );
    return json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
