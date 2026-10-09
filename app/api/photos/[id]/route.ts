import { get } from "@/lib/db";
import { db } from "@/server/db";

/** Inspector-uploaded photos (stored in the database so the demo works on read-only hosts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = get<{ mime: string; data: Uint8Array }>(db(), "SELECT mime, data FROM photo_blobs WHERE id = ?", Number((await params).id));
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(p.data), { headers: { "Content-Type": p.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
}
