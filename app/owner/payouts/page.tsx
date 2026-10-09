import Link from "next/link";
import { todayIn } from "@/booking-engine";
import { ar, fmtMoney, fmtMonth, fmtRange } from "@/market/format";
import { ownerStatement } from "@/market/owner";
import { settings } from "@/market/repo";
import { db } from "@/server/db";
import { requireOwner } from "@/server/session";

export const dynamic = "force-dynamic";
const ST: Record<string, [string, string]> = { held: ["محفوظ لحد الوصول", "warn"], releasable: ["في الدفعة الجاية", "sea"], paid: ["تم التحويل", "ok"], frozen: ["متوقف (بلاغ)", "bad"], cancelled: ["اتلغى", ""] };

function shift(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Monthly owner statement: gross, commission (by plan at booking time), net, payout status. */
export default async function Payouts({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { owner } = await requireOwner();
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : todayIn(settings(db()).timezone).slice(0, 7);
  const rows = ownerStatement(db(), owner.id, month);
  const gross = rows.reduce((s, r) => s + r.nights_total, 0);
  const net = rows.filter((r) => r.payout_status !== "cancelled").reduce((s, r) => s + r.payout, 0);
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>المدفوعات · كشف حساب {fmtMonth(month)}</h1>
          <div className="muted">التحويل على {owner.payout_masked ?? "— (كمّل بيانات التحويل)"}</div>
        </div>
        <span style={{ display: "flex", gap: 6 }}>
          <Link className="pill sm" href={`/owner/payouts?m=${shift(month, -1)}`} prefetch={false}>
            الشهر السابق
          </Link>
          <Link className="pill sm" href={`/owner/payouts?m=${shift(month, 1)}`} prefetch={false}>
            الشهر التالي
          </Link>
        </span>
      </div>
      <div className="kpis">
        <div className="panel kpi">
          <span className="muted">إجمالي الليالي</span>
          <span className="v">{fmtMoney(gross)}</span>
        </div>
        <div className="panel kpi">
          <span className="muted">عمولة مصيف</span>
          <span className="v">{fmtMoney(Math.max(0, gross - net))}</span>
        </div>
        <div className="panel kpi">
          <span className="muted">صافي مستحقك</span>
          <span className="v">{fmtMoney(net)}</span>
        </div>
      </div>
      <section className="panel">
        <div style={{ overflowX: "auto" }}>
          <table className="data" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>الحجز</th>
                <th>الوحدة</th>
                <th>التواريخ</th>
                <th>الإجمالي</th>
                <th>العمولة</th>
                <th>الصافي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ref}>
                  <td dir="ltr" style={{ textAlign: "right" }}>
                    {r.ref}
                  </td>
                  <td>{r.title_ar}</td>
                  <td>{fmtRange(r.check_in, r.check_out)}</td>
                  <td>{fmtMoney(r.nights_total)}</td>
                  <td>
                    {ar(r.commission_pct)}٪ ({r.plan === "managed" ? "إدارة كاملة" : "عمولة"})
                  </td>
                  <td>{fmtMoney(r.payout)}</td>
                  <td>
                    <span className={`tag ${ST[r.payout_status]?.[1] ?? ""}`}>{ST[r.payout_status]?.[0] ?? r.payout_status}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    مفيش إقامات في الشهر ده.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
