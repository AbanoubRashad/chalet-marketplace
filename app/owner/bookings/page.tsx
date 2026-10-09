import { Flash } from "@/components/ui";
import { ar, fmtMoney, fmtRange } from "@/market/format";
import { ownerScope } from "@/market/repo";
import { db } from "@/server/db";
import { requireOwner } from "@/server/session";
import { damageAction, ownerCancelAction } from "../actions";

export const dynamic = "force-dynamic";

const ST: Record<string, [string, string]> = {
  confirmed: ["مؤكد", "sea"],
  checked_in: ["الضيف وصل", "ok"],
  completed: ["خلص", ""],
  cancelled: ["ملغي", "bad"],
  disputed: ["فيه بلاغ", "bad"],
};

export default async function OwnerBookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { owner } = await requireOwner();
  const scope = ownerScope(db(), owner.id);
  const listings = scope.listings();
  return (
    <>
      <div className="dash-top">
        <h1>الحجوزات</h1>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      {listings.map((l) => (
        <section key={l.id} className="panel" aria-label={l.title_ar}>
          <h2>{l.title_ar}</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>الحجز</th>
                  <th>الضيف</th>
                  <th>التواريخ</th>
                  <th>الأفراد</th>
                  <th>مستحقك</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scope
                  .bookings(l.id)
                  .reverse()
                  .slice(0, 40)
                  .map((b) => (
                    <tr key={b.id}>
                      <td dir="ltr" style={{ textAlign: "right" }}>
                        {b.ref}
                      </td>
                      <td>{b.guest_name ?? "—"}</td>
                      <td>{fmtRange(b.check_in, b.check_out)}</td>
                      <td>{ar(b.guests_count)}</td>
                      <td>{fmtMoney(b.payout_amount ?? b.owner_payout)}</td>
                      <td>
                        <span className={`tag ${ST[b.status]?.[1] ?? ""}`}>{ST[b.status]?.[0] ?? b.status}</span>
                      </td>
                      <td>
                        {["checked_in", "completed"].includes(b.status) ? (
                          <details>
                            <summary style={{ cursor: "pointer", fontWeight: 700 }}>بلّغ عن تلفيات</summary>
                            <form action={damageAction} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                              <input type="hidden" name="back" value="/owner/bookings" />
                              <input type="hidden" name="booking" value={b.id} />
                              <textarea name="description" required minLength={5} placeholder="إيه اللي حصل؟" />
                              <input name="evidence" placeholder="روابط صور / فواتير" />
                              <button className="pill sm danger" type="submit">
                                ابعت (التأمين هيتوقف)
                              </button>
                            </form>
                          </details>
                        ) : b.status === "confirmed" ? (
                          <form action={ownerCancelAction}>
                            <input type="hidden" name="back" value="/owner/bookings" />
                            <input type="hidden" name="booking" value={b.id} />
                            <button className="pill sm danger" type="submit">
                              إلغاء (استرداد كامل للضيف)
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
