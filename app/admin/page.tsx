import Link from "next/link";
import { all, get } from "@/lib/db";
import { Flash } from "@/components/ui";
import { ar, fmtMoney, fmtRange } from "@/market/format";
import { settings } from "@/market/repo";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";
import { listingStatusAction, payoutBatchAction, resolveAction, runJobsAction, settingsAction, syncAllAction } from "./actions";

export const dynamic = "force-dynamic";

const ISSUE: Record<string, string> = { not_as_described: "مش زي الوصف", access: "مشكلة استلام", damage: "تلفيات", other: "أخرى" };
const LST: Record<string, [string, string]> = { draft: ["مسودة", "warn"], inspected: ["اتعاينت", "sea"], live: ["منشورة", "ok"], paused: ["متوقفة", ""] };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  await requireRole(["admin"]);
  const d = db();
  const s = settings(d);
  const listings = all<{ id: number; slug: string; title_ar: string; status: string; owner: string }>(d, "SELECT l.id, l.slug, l.title_ar, l.status, o.display_name AS owner FROM listings l JOIN owners o ON o.id = l.owner_id ORDER BY l.id");
  const issues = all<{ id: number; type: string; description: string; evidence: string; raised_by: string; ref: string; check_in: string; check_out: string; title_ar: string; security_deposit: number; nights_total: number }>(
    d,
    `SELECT i.*, b.ref, b.check_in, b.check_out, b.security_deposit, b.nights_total, l.title_ar FROM issues i JOIN bookings b ON b.id = i.booking_id JOIN listings l ON l.id = b.listing_id WHERE i.status = 'open' ORDER BY i.id`,
  );
  const payouts = get<{ n: number; total: number }>(d, "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payouts WHERE status = 'releasable'")!;
  const held = get<{ n: number; total: number }>(d, "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payouts WHERE status IN ('held','frozen')")!;
  const feeds = all<{ id: number; provider: string; title_ar: string; last_sync_at: string | null; last_status: string | null; last_error: string | null; events_count: number }>(
    d,
    "SELECT f.*, l.title_ar FROM ical_feeds f JOIN listings l ON l.id = f.listing_id ORDER BY f.id",
  );
  const conflicts = all<{ title_ar: string; start_date: string; end_date: string; summary: string }>(
    d,
    "SELECT l.title_ar, b.start_date, b.end_date, b.summary FROM calendar_blocks b JOIN listings l ON l.id = b.listing_id WHERE b.status = 'active' AND b.conflict = 1",
  );
  const needsRefund = get<{ n: number }>(d, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payment.needs_refund'")!.n;
  const staleMs = s.ical_stale_minutes * 60_000;

  return (
    <>
      <div className="dash-top">
        <div>
          <h1>نظرة عامة</h1>
          <div className="muted">{s.launched ? "المنصة مفتوحة للضيوف" : "وضع العرض فقط: البحث والحجز مخفيين عن الجمهور لحد الإطلاق"}</div>
        </div>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <form action={syncAllAction}>
            <button className="pill" type="submit">
              زامن كل التقاويم
            </button>
          </form>
          <form action={runJobsAction}>
            <button className="pill" type="submit">
              شغّل المهام الآن
            </button>
          </form>
        </span>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="kpis">
        <div className="panel kpi">
          <span className="muted">مستحقات جاهزة للتحويل</span>
          <span className="v">{fmtMoney(payouts.total)}</span>
          <span className="muted">{ar(payouts.n)} حجز</span>
        </div>
        <div className="panel kpi">
          <span className="muted">محفوظ لحد الوصول / متوقف</span>
          <span className="v">{fmtMoney(held.total)}</span>
          <span className="muted">{ar(held.n)} حجز</span>
        </div>
        <div className="panel kpi">
          <span className="muted">بلاغات مفتوحة</span>
          <span className="v">{ar(issues.length)}</span>
        </div>
        <div className="panel kpi">
          <span className="muted">تعارضات تقويم</span>
          <span className="v">{ar(conflicts.length)}</span>
          {needsRefund ? <span style={{ color: "var(--danger)" }}>{ar(needsRefund)} دفعة محتاجة استرداد</span> : null}
        </div>
      </div>

      <div className="cols">
        <div className="col-main">
          <section className="panel" aria-labelledby="disp">
            <h2 id="disp">البلاغات</h2>
            {issues.length === 0 ? <div className="muted">مفيش بلاغات مفتوحة.</div> : null}
            {issues.map((i) => (
              <details key={i.id} className="editor" open>
                <summary>
                  <span className="tag bad">{ISSUE[i.type]}</span>&nbsp;{i.title_ar} · {fmtRange(i.check_in, i.check_out)} · {i.ref} · من {i.raised_by === "guest" ? "الضيف" : "المالك"}
                </summary>
                <p style={{ margin: "4px 0" }}>{i.description}</p>
                {i.evidence ? <p className="muted" style={{ margin: 0 }}>الدليل: {i.evidence}</p> : null}
                <form action={resolveAction} className="form-grid">
                  <input type="hidden" name="id" value={i.id} />
                  <label className="field">
                    القرار
                    <select name="resolution" defaultValue={i.type === "damage" ? "capture_deposit" : "refund_guest"}>
                      <option value="refund_guest">استرداد جزء للضيف</option>
                      <option value="capture_deposit">خصم من التأمين للمالك</option>
                      <option value="pay_owner">مفيش مشكلة · كمّل التحويل</option>
                    </select>
                  </label>
                  <label className="field">
                    المبلغ (ج.م)
                    <input name="amount" inputMode="numeric" defaultValue={0} />
                    <span className="hint">
                      التأمين {fmtMoney(i.security_deposit)} · الليالي {fmtMoney(i.nights_total)}
                    </span>
                  </label>
                  <label className="field full">
                    ملاحظة القرار
                    <input name="note" required />
                  </label>
                  <button className="pill dark" type="submit">
                    اقفل البلاغ
                  </button>
                </form>
              </details>
            ))}
          </section>

          <section className="panel" aria-labelledby="pipe">
            <h2 id="pipe">الوحدات: مسودة ← معاينة ← منشورة</h2>
            <table className="data">
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/inspector/${l.id}`} prefetch={false}>
                        {l.title_ar}
                      </Link>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {l.owner}
                      </div>
                    </td>
                    <td>
                      <span className={`tag ${LST[l.status]?.[1]}`}>{LST[l.status]?.[0]}</span>
                    </td>
                    <td>
                      <form action={listingStatusAction} style={{ display: "flex", gap: 6 }}>
                        <input type="hidden" name="id" value={l.id} />
                        {l.status === "inspected" || l.status === "paused" ? (
                          <button className="pill sm sea" name="status" value="live" type="submit">
                            انشر
                          </button>
                        ) : null}
                        {l.status === "live" ? (
                          <button className="pill sm" name="status" value="paused" type="submit">
                            أوقف
                          </button>
                        ) : null}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="col-side">
          <section className="panel" aria-labelledby="po">
            <h2 id="po">دفعة التحويلات</h2>
            <div>
              {ar(payouts.n)} مستحق جاهز بإجمالي {fmtMoney(payouts.total)}.
            </div>
            <form action={payoutBatchAction}>
              <button className="pill dark" type="submit" disabled={!payouts.n} style={{ width: "100%" }}>
                حوّل الدفعة
              </button>
            </form>
          </section>

          <section className="panel" aria-labelledby="fh">
            <h2 id="fh">صحة التقاويم المربوطة</h2>
            {feeds.map((f) => {
              const stale = !f.last_sync_at || Date.now() - Date.parse(f.last_sync_at) > staleMs;
              return (
                <div key={f.id} className="row-line">
                  <span>
                    {f.provider} · {f.title_ar}
                    {f.last_error ? (
                      <span style={{ display: "block", color: "var(--danger)", fontSize: 12 }}>{f.last_error}</span>
                    ) : null}
                  </span>
                  <span className={`tag ${f.last_status === "error" ? "bad" : stale ? "warn" : "ok"}`}>{f.last_status === "error" ? "خطأ" : stale ? "قديم" : "سليم"}</span>
                </div>
              );
            })}
            {conflicts.map((c, i) => (
              <div key={i} className="flash err" style={{ fontSize: 13 }}>
                تعارض: {c.title_ar} · {fmtRange(c.start_date, c.end_date)} · {c.summary}
              </div>
            ))}
          </section>

          <form action={settingsAction} className="panel" aria-labelledby="st">
            <h2 id="st">إعدادات المنصة</h2>
            <label className="check">
              <input type="checkbox" name="launched" defaultChecked={Boolean(s.launched)} /> مفتوحة للضيوف (البحث والحجز ظاهرين)
            </label>
            <label className="check">
              <input type="checkbox" name="require_guest_id" defaultChecked={Boolean(s.require_guest_id)} /> التحقق من هوية الضيف قبل أول حجز
            </label>
            <div className="form-grid">
              {(
                [
                  ["service_fee_pct", "رسوم الخدمة ٪", s.service_fee_pct],
                  ["commission_pct", "عمولة ٪", s.commission_pct],
                  ["managed_pct", "إدارة كاملة ٪", s.managed_pct],
                  ["payout_release_hours", "تحويل بعد (ساعة)", s.payout_release_hours],
                  ["deposit_return_days", "رجوع التأمين (يوم)", s.deposit_return_days],
                  ["ical_sync_minutes", "مزامنة كل (دقيقة)", s.ical_sync_minutes],
                ] as [string, string, number][]
              ).map(([k, label, v]) => (
                <label key={k} className="field">
                  {label}
                  <input name={k} inputMode="decimal" defaultValue={v} />
                </label>
              ))}
            </div>
            <button className="pill dark" type="submit">
              حفظ
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
