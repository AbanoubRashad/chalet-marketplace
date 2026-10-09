import Link from "next/link";
import { all } from "@/lib/db";
import { ar, fmtDateShort } from "@/market/format";
import { listingCard, ownerScope, photos } from "@/market/repo";
import { db } from "@/server/db";
import { requireOwner } from "@/server/session";

export const dynamic = "force-dynamic";
const STATUS: Record<string, string> = { draft: "مسودة (لسه في المعاينة)", inspected: "اتعاينت · مستنية النشر", live: "منشورة", paused: "متوقفة" };

export default async function OwnerListing() {
  const { owner } = await requireOwner();
  const d = db();
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>بيانات الوحدة والصور</h1>
          <div className="muted">الصور والبيانات بيدخلها فريق المعاينة بعد الزيارة، عشان كل اللي بيظهر للضيف يكون حقيقي. لو عايز تعدّل حاجة كلّمنا.</div>
        </div>
      </div>
      {ownerScope(d, owner.id)
        .listings()
        .map((l) => {
          const c = listingCard(d, l.id)!;
          const insp = all<{ inspected_at: string; passed: number; notes: string; name: string }>(
            d,
            "SELECT i.inspected_at, i.passed, i.notes, u.name FROM inspections i JOIN users u ON u.id = i.inspector_user_id WHERE i.listing_id = ? ORDER BY i.id DESC LIMIT 1",
            l.id,
          )[0];
          return (
            <section key={l.id} className="panel">
              <h2>
                {l.title_ar} · <span className="tag sea">{STATUS[l.status]}</span>
              </h2>
              <div className="muted">
                {c.region_ar} · {c.compound_ar} · كم {ar(c.km_marker ?? 0)} · {ar(l.capacity)} أفراد · {ar(l.rooms)} غرف · {ar(l.baths)} حمام
              </div>
              {insp ? (
                <div>
                  آخر معاينة: {fmtDateShort(insp.inspected_at.slice(0, 10))} مع {insp.name} · {insp.passed ? "كل البنود تمام" : "فيه بنود محتاجة تتصلح"}
                </div>
              ) : null}
              <div className="photo-grid">
                {photos(d, l.id).map((p) => (
                  <figure key={p.id}>
                    <img src={p.url} alt="" />
                    <figcaption>
                      <span>{p.photographed_by_us ? "صورة فريقنا" : "صورة المالك"}</span>
                      <span className="muted">{p.taken_on ? fmtDateShort(p.taken_on) : ""}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
              {l.status === "live" ? (
                <Link href={`/chalets/${l.slug}`} prefetch={false} style={{ fontWeight: 700 }}>
                  شوف صفحة الوحدة زي ما الضيف بيشوفها
                </Link>
              ) : null}
            </section>
          );
        })}
    </>
  );
}
