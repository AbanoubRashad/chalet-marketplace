import Link from "next/link";
import { redirect } from "next/navigation";
import { all } from "@/lib/db";
import { Flash } from "@/components/ui";
import { createDraftListing } from "@/market/admin";
import { MarketError } from "@/market/booking";
import { ar } from "@/market/format";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";
const STATUS: Record<string, [string, string]> = { draft: ["مسودة", "warn"], inspected: ["اتعاينت", "sea"], live: ["منشورة", "ok"], paused: ["متوقفة", ""] };

async function create(f: FormData) {
  "use server";
  const { actor } = await requireRole(["inspector", "admin"]);
  let id: number;
  try {
    id = createDraftListing(db(), actor, {
      ownerId: Number(f.get("owner")),
      compoundId: Number(f.get("compound")),
      title: String(f.get("title") ?? ""),
      capacity: Number(f.get("capacity")),
      rooms: Number(f.get("rooms")),
      baths: Number(f.get("baths")),
      parking: Number(f.get("parking") || 0),
      beachfront: f.get("beach") === "on",
      pool: f.get("pool") === "on",
      note: String(f.get("note") ?? ""),
      base: Number(f.get("base")),
      deposit: Number(f.get("deposit") || 0),
    });
  } catch (err) {
    redirect(`/inspector?err=${encodeURIComponent(err instanceof MarketError ? err.message : "حصلت مشكلة")}`);
  }
  redirect(`/inspector/${id}`);
}

export default async function InspectorHome({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  await requireRole(["inspector", "admin"]);
  const d = db();
  const listings = all<{ id: number; title_ar: string; status: string; owner: string; compound: string; photos: number }>(
    d,
    `SELECT l.id, l.title_ar, l.status, o.display_name AS owner, c.name_ar AS compound, (SELECT COUNT(*) FROM listing_photos p WHERE p.listing_id = l.id) AS photos
       FROM listings l JOIN owners o ON o.id = l.owner_id JOIN compounds c ON c.id = l.compound_id ORDER BY CASE l.status WHEN 'draft' THEN 0 WHEN 'inspected' THEN 1 ELSE 2 END, l.id DESC`,
  );
  const owners = all<{ id: number; display_name: string }>(d, "SELECT id, display_name FROM owners ORDER BY display_name");
  const compounds = all<{ id: number; name_ar: string; km_marker: number }>(d, "SELECT id, name_ar, km_marker FROM compounds ORDER BY km_marker");
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>الوحدات</h1>
          <div className="muted">من الموبايل في الموقع: سجّل الوحدة، صوّر بالترتيب، اعمل قائمة الفحص، واعتمدها.</div>
        </div>
      </div>
      <Flash err={err} />
      <section className="panel">
        {listings.map((l) => (
          <Link key={l.id} href={`/inspector/${l.id}`} className="row-line" style={{ color: "var(--ink)", textDecoration: "none" }} prefetch={false}>
            <span>
              <b>{l.title_ar}</b>
              <span className="muted" style={{ display: "block", fontSize: 13 }}>
                {l.compound} · {l.owner} · {ar(l.photos)} صور
              </span>
            </span>
            <span className={`tag ${STATUS[l.status]?.[1]}`}>{STATUS[l.status]?.[0]}</span>
          </Link>
        ))}
      </section>
      <details className="panel" open={listings.every((l) => l.status !== "draft")}>
        <summary style={{ fontWeight: 800, cursor: "pointer", minHeight: 40 }}>+ وحدة جديدة (مسودة)</summary>
        <form action={create} className="form-grid">
          <label className="field">
            المالك
            <select name="owner" required>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            القرية
            <select name="compound" required>
              {compounds.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_ar} · كم {ar(c.km_marker)}
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            العنوان على الموقع
            <input name="title" required minLength={5} placeholder="شاليه ٢ غرف صف تاني · النورس" />
          </label>
          <label className="field">
            أفراد
            <input name="capacity" type="number" min={1} required defaultValue={6} />
          </label>
          <label className="field">
            غرف
            <input name="rooms" type="number" min={1} required defaultValue={2} />
          </label>
          <label className="field">
            حمامات
            <input name="baths" type="number" min={1} required defaultValue={1} />
          </label>
          <label className="field">
            عربيات
            <input name="parking" type="number" min={0} defaultValue={1} />
          </label>
          <label className="field">
            سعر الليلة
            <input name="base" type="number" min={1} required />
          </label>
          <label className="field">
            التأمين
            <input name="deposit" type="number" min={0} defaultValue={2000} />
          </label>
          <label className="field full">
            وصف المكان
            <input name="note" placeholder="صف تاني · ٣ دقايق مشي للبحر" />
          </label>
          <label className="check">
            <input type="checkbox" name="beach" /> على البحر مباشرة
          </label>
          <label className="check">
            <input type="checkbox" name="pool" /> حمام سباحة
          </label>
          <button className="pill dark" type="submit">
            إنشاء المسودة
          </button>
        </form>
      </details>
    </>
  );
}
