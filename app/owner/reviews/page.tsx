import { all } from "@/lib/db";
import { Flash } from "@/components/ui";
import { fmtDateShort } from "@/market/format";
import { db } from "@/server/db";
import { requireOwner } from "@/server/session";
import { replyAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function OwnerReviews({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { owner } = await requireOwner();
  const rows = all<{ id: number; title_ar: string; author_name: string; rating: number; text: string; reply: string | null; created_at: string }>(
    db(),
    "SELECT v.*, l.title_ar FROM reviews v JOIN listings l ON l.id = v.listing_id WHERE l.owner_id = ? AND v.author_side = 'guest' ORDER BY v.created_at DESC LIMIT 60",
    owner.id,
  );
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>التقييمات</h1>
          <div className="muted">التقييمات بتيجي بس من ضيوف سكنوا فعلًا بحجز على المنصة. تقدر ترد مرة واحدة على كل تقييم.</div>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      {rows.map((r) => (
        <article key={r.id} className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>
              {r.author_name} · {r.title_ar}
            </strong>
            <span aria-label={`${r.rating} من ٥`}>{"★".repeat(r.rating)}</span>
          </div>
          <div>{r.text}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {fmtDateShort(r.created_at.slice(0, 10))}
          </div>
          {r.reply ? (
            <div className="note-box">ردك: {r.reply}</div>
          ) : (
            <form action={replyAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="hidden" name="back" value="/owner/reviews" />
              <input type="hidden" name="review" value={r.id} />
              <label className="sr-only" htmlFor={`r${r.id}`}>
                ردك
              </label>
              <input id={`r${r.id}`} name="reply" required maxLength={600} placeholder="اكتب ردك…" style={{ flex: 1, minHeight: 44, border: "1px solid var(--border-2)", borderRadius: 12, paddingInline: 12 }} />
              <button className="pill dark sm" type="submit">
                رد
              </button>
            </form>
          )}
        </article>
      ))}
    </>
  );
}
