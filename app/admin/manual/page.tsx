import { all } from "@/lib/db";
import { Flash } from "@/components/ui";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";
import { manualAction } from "../actions";

export const dynamic = "force-dynamic";

/** Managed plan: our team takes a booking by phone and records an offline payment. Same overlap guarantees apply. */
export default async function Manual({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  await requireRole(["admin"]);
  const listings = all<{ id: number; title_ar: string }>(
    db(),
    "SELECT l.id, l.title_ar FROM listings l JOIN owners o ON o.id = l.owner_id WHERE o.plan = 'managed' AND l.status = 'live' ORDER BY l.id",
  );
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>حجز يدوي</h1>
          <div className="muted">لوحدات الإدارة الكاملة: حجز بالتليفون ودفع خارج المنصة (تحويل / كاش في المكتب).</div>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={manualAction} className="panel form-grid">
        <label className="field full">
          الوحدة
          <select name="listing" required>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title_ar}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          الوصول
          <input type="date" name="in" required />
        </label>
        <label className="field">
          المغادرة
          <input type="date" name="out" required />
        </label>
        <label className="field">
          الأفراد
          <input type="number" name="guests" min={1} defaultValue={4} required />
        </label>
        <label className="field">
          اسم الضيف
          <input name="name" required minLength={3} />
        </label>
        <label className="field">
          موبايل الضيف
          <input name="phone" required dir="ltr" inputMode="tel" />
        </label>
        <button className="pill dark" type="submit">
          سجّل الحجز
        </button>
      </form>
    </>
  );
}
