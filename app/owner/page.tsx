import Link from "next/link";
import { all, get } from "@/lib/db";
import { todayIn } from "@/booking-engine";
import { Flash } from "@/components/ui";
import { exportToken } from "@/market/ical";
import { ownerMonth } from "@/market/owner";
import { ar, fmtMoney, fmtMonth, fmtNum, fmtRange, WEEKDAYS_AR } from "@/market/format";
import { listingCard, ownerScope, priceRuleRows, settings } from "@/market/repo";
import { POLICY_TEXT } from "@/market/types";
import { db } from "@/server/db";
import { requireOwner } from "@/server/session";
import { originOf } from "@/server/api";
import { headers } from "next/headers";
import { depositAction, feedAction, planAction, pricingAction, removeSeasonAction, seasonAction, syncAction, toggleNightAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  held: ["محفوظ لحد الوصول", "warn"],
  releasable: ["هيتحوّل في الدفعة الجاية", "sea"],
  paid: ["تم التحويل", "ok"],
  frozen: ["متوقف (بلاغ)", "bad"],
  cancelled: ["اتلغى", ""],
};

function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function ago(iso: string | null) {
  if (!iso) return "لسه";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "الآن";
  if (min < 60) return `منذ ${ar(min)} دقائق`;
  if (min < 1440) return `منذ ${ar(Math.round(min / 60))} ساعة`;
  return `منذ ${ar(Math.round(min / 1440))} يوم`;
}

export default async function OwnerCalendar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { owner } = await requireOwner();
  const d = db();
  const s = settings(d);
  const scope = ownerScope(d, owner.id);
  const listings = scope.listings();
  if (!listings.length)
    return (
      <div className="panel">
        <h1 style={{ margin: 0 }}>أهلًا {owner.display_name}</h1>
        <p>لسه مفيش وحدة متسجلة باسمك. فريق المعاينة هيتواصل معاك لتحديد ميعاد الزيارة والتصوير. كمّل بيانات التحقق والتحويل من <Link href="/owner/verification">التحقق والمستندات</Link>.</p>
      </div>
    );
  const l = listings.find((x) => String(x.id) === sp.l) ?? listings[0]!;
  const card = listingCard(d, l.id)!;
  const today = todayIn(s.timezone);
  const nextEvent = get<{ start_date: string }>(d, "SELECT start_date FROM calendar_blocks WHERE listing_id = ? AND status = 'active' AND end_date > ? ORDER BY start_date LIMIT 1", l.id, today);
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : (nextEvent?.start_date ?? today).slice(0, 7);
  const days = ownerMonth(d, owner.id, l.id, month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 1) % 7;
  const bookings = scope.bookings(l.id).filter((b) => b.check_out >= addMonths(month, -1) + "-01").slice(0, 8);
  const external = all<{ start_date: string; end_date: string; summary: string }>(d, "SELECT start_date, end_date, summary FROM calendar_blocks WHERE listing_id = ? AND status = 'active' AND source = 'ical_import' AND end_date >= ? ORDER BY start_date LIMIT 4", l.id, `${month}-01`);
  const feeds = all<{ id: number; provider: string; last_sync_at: string | null; last_status: string | null; last_error: string | null; events_count: number }>(d, "SELECT * FROM ical_feeds WHERE listing_id = ? ORDER BY id", l.id);
  const rules = priceRuleRows(d, l.id);
  const base = rules.find((r) => r.type === "base");
  const uplift = rules.find((r) => r.type === "weekday_uplift");
  const seasons = rules.filter((r) => r.type === "season" && (r.end_date ?? "9999") > today);
  const weekly = get<{ percent: number }>(d, "SELECT percent FROM los_discounts WHERE listing_id = ? AND min_nights = 7", l.id);
  const back = `/owner?l=${l.id}&m=${month}`;
  const exportUrl = `${originOf(await headers())}/api/ical/${exportToken(l.ical_export_token)}.ics`;
  const conflicts = days.filter((x) => x.conflict).length;
  const providers = new Set(feeds.map((f) => f.provider));
  const Hidden = () => (
    <>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="listing" value={l.id} />
    </>
  );
  const seasonMin = Math.max(...seasons.map((r) => r.min_nights ?? 0), 0);

  return (
    <>
      <div className="dash-top">
        <div>
          <h1>{l.title_ar}</h1>
          <div className="muted">
            {card.region_ar} · كم {ar(card.km_marker ?? 0)} · المالك: {owner.display_name}
          </div>
        </div>
        <form action={planAction} className="seg" role="group" aria-label="خطة التعاون">
          <Hidden />
          <button name="plan" value="commission" aria-pressed={owner.plan === "commission"} type="submit">
            عمولة على الحجز
          </button>
          <button name="plan" value="managed" aria-pressed={owner.plan === "managed"} type="submit">
            إدارة كاملة
          </button>
        </form>
      </div>
      {listings.length > 1 ? (
        <nav className="chips" aria-label="وحداتك">
          {listings.map((x) => (
            <Link key={x.id} className={`chip${x.id === l.id ? " on" : ""}`} href={`/owner?l=${x.id}`} prefetch={false}>
              {x.title_ar}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="note-box">
        {owner.plan === "commission"
          ? `خطة العمولة: انت بتستلم الضيوف بنفسك، واحنا ناخد ${ar(s.commission_pct)}٪ من كل حجز.`
          : `الإدارة الكاملة: فريقنا بيستلم ويسلّم ويتابع النظافة، مقابل ${ar(s.managed_pct)}٪ من الإيراد.`}{" "}
        <span className="muted" style={{ fontSize: 13 }}>
          (تغيير الخطة بيطبق على الحجوزات الجديدة بس)
        </span>
      </div>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="cols">
        <div className="col-main">
          <section className="panel" aria-labelledby="cal-h">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Link className="icon-btn" href={`/owner?l=${l.id}&m=${addMonths(month, -1)}`} aria-label="الشهر السابق" prefetch={false}>
                  ›
                </Link>
                <h2 id="cal-h" style={{ fontSize: 16 }}>
                  {fmtMonth(month)}
                </h2>
                <Link className="icon-btn" href={`/owner?l=${l.id}&m=${addMonths(month, 1)}`} aria-label="الشهر التالي" prefetch={false}>
                  ‹
                </Link>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                اضغط يوم لقفله أو فتحه
              </span>
            </div>
            <div className="cal-head" style={{ gap: 6, fontSize: 12 }} aria-hidden="true">
              {["سبت", "أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="ocal">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`p${i}`} className="oday pad" />
              ))}
              {days.map((x) => {
                const n = ar(Number(x.date.slice(8)));
                const cls = `oday ${x.state === "free" ? "" : x.state}${x.conflict ? " conflict" : ""}`;
                const label = `${n} ${fmtMonth(month)}: ${x.label}${x.conflict ? " (تعارض)" : ""}`;
                return x.state === "free" || x.state === "blk" ? (
                  <form key={x.date} action={toggleNightAction}>
                    <Hidden />
                    <input type="hidden" name="date" value={x.date} />
                    <button className={cls} type="submit" aria-label={`${label}، اضغط ${x.state === "blk" ? "للفتح" : "للقفل"}`} disabled={x.date < today}>
                      <b>{n}</b>
                      <small>{x.label}</small>
                    </button>
                  </form>
                ) : (
                  <div key={x.date} className={cls} aria-label={label} role="img">
                    <b>{n}</b>
                    <small>{x.label}</small>
                  </div>
                );
              })}
            </div>
            <div className="legend" style={{ color: "var(--ink-2)", gap: 14 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="sw" style={{ background: "var(--sea)" }} />
                حجز على المنصة
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="sw" style={{ background: "var(--external)" }} />
                من Airbnb / Booking
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="sw" style={{ background: "var(--blocked)" }} />
                مقفول من المالك
              </span>
            </div>
            {conflicts ? <div className="flash err">فيه {ar(conflicts)} ليلة متحجزة على المنصة وعلى منصة تانية في نفس الوقت. فريقنا اتبلّغ وهيتواصل معاك.</div> : null}
          </section>

          <section className="panel" aria-labelledby="bk-h">
            <h2 id="bk-h">الحجوزات القادمة والمدفوعات</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="data" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>الضيف</th>
                    <th>التواريخ</th>
                    <th>المصدر</th>
                    <th>مستحقك</th>
                    <th>حالة الدفع</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...bookings.map((b) => ({ key: `b${b.id}`, start: b.check_in, g: b.guest_name ?? "—", dates: fmtRange(b.check_in, b.check_out), src: "المنصة", pay: fmtMoney(b.payout_amount ?? b.owner_payout), st: STATUS[b.payout_status ?? "held"] ?? [b.payout_status ?? "", ""] })),
                    ...external.map((e, i) => ({ key: `e${i}`, start: e.start_date, g: e.summary.split(" · ").pop()?.replace(/^Reserved$/, "ضيف خارجي") ?? "ضيف خارجي", dates: fmtRange(e.start_date, e.end_date), src: e.summary.split(" · ")[0] ?? "خارجي", pay: "—", st: ["خارج المنصة", ""] as [string, string] })),
                  ]
                    .sort((a, b) => (a.start < b.start ? -1 : 1))
                    .map((r) => (
                      <tr key={r.key}>
                        <td>{r.g}</td>
                        <td>{r.dates}</td>
                        <td>{r.src}</td>
                        <td>{r.pay}</td>
                        <td>
                          <span className={`tag ${r.st[1]}`}>{r.st[0]}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Link href={`/owner/bookings?l=${l.id}`} style={{ fontWeight: 700 }} prefetch={false}>
              كل الحجوزات
            </Link>
          </section>
        </div>

        <div className="col-side">
          <section className="panel" aria-labelledby="sync-h">
            <h2 id="sync-h">مزامنة التقويم</h2>
            {["Airbnb", "Booking.com"].map((p) => {
              const f = feeds.find((x) => x.provider === p);
              return (
                <div key={p} className="row-line">
                  <span>{p}</span>
                  {f ? (
                    f.last_status === "error" ? (
                      <span style={{ color: "var(--danger)", fontWeight: 700 }} title={f.last_error ?? ""}>
                        خطأ في المزامنة
                      </span>
                    ) : (
                      <span style={{ color: "var(--success)", fontWeight: 700 }}>متصل · iCal</span>
                    )
                  ) : (
                    <a href="#add-feed" style={{ fontWeight: 700 }}>
                      اربط الرابط
                    </a>
                  )}
                </div>
              );
            })}
            <div className="muted" style={{ fontSize: 12 }}>
              آخر مزامنة: {ago(feeds.map((f) => f.last_sync_at).filter(Boolean).sort().pop() ?? null)}. المزامنة التلقائية كل {ar(s.ical_sync_minutes)} دقيقة.
            </div>
            <form action={syncAction}>
              <Hidden />
              <button className="pill" style={{ width: "100%", borderRadius: 10 }} type="submit">
                زامن الآن
              </button>
            </form>
            <details className="editor" id="add-feed">
              <summary>+ ربط تقويم خارجي</summary>
              <form action={feedAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Hidden />
                <label className="field">
                  المنصة
                  <select name="provider" defaultValue={providers.has("Booking.com") ? "Other" : "Booking.com"}>
                    <option value="Booking.com">Booking.com</option>
                    <option value="Airbnb">Airbnb</option>
                    <option value="Other">تانية</option>
                  </select>
                </label>
                <label className="field">
                  رابط iCal (Export)
                  <input name="url" required dir="ltr" placeholder="https://…/calendar.ics" />
                </label>
                <button className="pill dark sm" type="submit">
                  اربط وزامن
                </button>
              </form>
            </details>
            <label className="field">
              رابط تقويمك على مصيف (الصقه في Airbnb / Booking.com)
              <input readOnly value={exportUrl} dir="ltr" style={{ fontSize: 12 }} />
              <span className="hint">رابط سري، متشاركهوش غير مع المنصات.</span>
            </label>
          </section>

          <section className="panel" aria-labelledby="pr-h">
            <h2 id="pr-h">قواعد التسعير</h2>
            <div className="row-line">
              <span>سعر الليلة العادي</span>
              <b>{base ? fmtMoney(base.amount ?? 0) : "—"}</b>
            </div>
            <div className="row-line">
              <span>{uplift?.weekdays ? uplift.weekdays.split(",").map((w) => WEEKDAYS_AR[Number(w)]).join(" و") : "الويك إند"}</span>
              <b>{uplift ? `+${ar(uplift.percent ?? 0)}٪` : "—"}</b>
            </div>
            {seasons.map((r) => (
              <div key={r.id} className="row-line">
                <span>
                  {r.label} <span className="muted" style={{ fontSize: 12 }}>({r.start_date && r.end_date ? fmtRange(r.start_date, r.end_date) : ""})</span>
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <b>{fmtMoney(r.amount ?? 0)}</b>
                  <form action={removeSeasonAction}>
                    <Hidden />
                    <input type="hidden" name="rule" value={r.id} />
                    <button className="pill sm danger" type="submit" aria-label={`حذف ${r.label}`} style={{ minHeight: 30, paddingInline: 8 }}>
                      ×
                    </button>
                  </form>
                </span>
              </div>
            ))}
            <div className="row-line">
              <span>أقل عدد ليالي</span>
              <b>
                {ar(base?.min_nights ?? 1)}
                {seasonMin ? ` (${ar(seasonMin)} في الموسم)` : ""}
              </b>
            </div>
            <div className="row-line">
              <span>خصم الإقامة الأسبوعية</span>
              <b>{weekly ? `${ar(weekly.percent)}٪` : "—"}</b>
            </div>
            <details className="editor">
              <summary>+ فترة موسم جديدة</summary>
              <form action={seasonAction} className="form-grid">
                <Hidden />
                <label className="field full">
                  الاسم
                  <input name="label" defaultValue="موسم الصيف والأعياد" />
                </label>
                <label className="field">
                  من
                  <input type="date" name="from" required min={today} />
                </label>
                <label className="field">
                  إلى (آخر ليلة)
                  <input type="date" name="to" required min={today} />
                </label>
                <label className="field">
                  سعر الليلة
                  <input name="amount" inputMode="numeric" required defaultValue={5500} />
                </label>
                <label className="field">
                  أقل ليالي
                  <input name="minNights" inputMode="numeric" defaultValue={3} />
                </label>
                <button className="pill dark sm" type="submit">
                  إضافة
                </button>
              </form>
            </details>
            <details className="editor">
              <summary>تعديل السعر الأساسي والويك إند</summary>
              <form action={pricingAction} className="form-grid">
                <Hidden />
                <label className="field">
                  سعر الليلة العادي
                  <input name="base" inputMode="numeric" required defaultValue={base?.amount ?? ""} />
                </label>
                <label className="field">
                  أقل ليالي
                  <input name="baseMin" inputMode="numeric" defaultValue={base?.min_nights ?? 1} />
                </label>
                <label className="field">
                  زيادة الويك إند ٪
                  <input name="uplift" inputMode="numeric" defaultValue={uplift?.percent ?? 0} />
                </label>
                <label className="field">
                  خصم أسبوعي ٪
                  <input name="weekly" inputMode="numeric" defaultValue={weekly?.percent ?? 0} />
                </label>
                <fieldset className="full" style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <legend style={{ fontWeight: 700, fontSize: 14 }}>أيام الويك إند</legend>
                  {[4, 5, 6].map((w) => (
                    <label key={w} className="check">
                      <input type="checkbox" name="days" value={w} defaultChecked={(uplift?.weekdays ?? "4,5").split(",").includes(String(w))} /> {WEEKDAYS_AR[w]}
                    </label>
                  ))}
                </fieldset>
                <button className="pill dark sm" type="submit">
                  حفظ
                </button>
              </form>
            </details>
          </section>

          <section className="panel" aria-labelledby="dp-h">
            <h2 id="dp-h">التأمين والإلغاء</h2>
            <div>تأمين مسترد: {fmtMoney(l.security_deposit)}</div>
            <div>سياسة الإلغاء: {POLICY_TEXT[l.cancellation_policy].name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              مستحقك بيتحوّل بعد {ar(s.payout_release_hours)} ساعات من تسجيل دخول الضيف لو مفيش بلاغ.
            </div>
            <details className="editor">
              <summary>تعديل</summary>
              <form action={depositAction} className="form-grid">
                <Hidden />
                <label className="field">
                  التأمين (ج.م)
                  <input name="deposit" inputMode="numeric" defaultValue={l.security_deposit} />
                </label>
                <label className="field">
                  سياسة الإلغاء
                  <select name="policy" defaultValue={l.cancellation_policy}>
                    {Object.entries(POLICY_TEXT).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.name}: {v.text}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="pill dark sm" type="submit">
                  حفظ
                </button>
              </form>
            </details>
          </section>
          <div className="muted" style={{ fontSize: 12 }}>
            إيرادك المتوقع للشهر: {fmtNum(bookings.filter((b) => b.check_in.startsWith(month)).reduce((t, b) => t + (b.payout_amount ?? 0), 0))} ج.م
          </div>
        </div>
      </div>
    </>
  );
}
