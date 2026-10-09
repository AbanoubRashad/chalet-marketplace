import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { get } from "@/lib/db";
import { decryptField } from "@/lib/crypto";
import { localFormat } from "@/lib/phone";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Flash, Icon } from "@/components/ui";
import { cancelBooking, checkInTime, guestCheckIn, MarketError, refundShare } from "@/market/booking";
import { addReview, demoCheckout, openIssue } from "@/market/stay";
import { ar, fmtMoney, fmtRange, nightsWord } from "@/market/format";
import { bookingByToken, listingCard, settings } from "@/market/repo";
import { POLICY_TEXT } from "@/market/types";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "رحلتك", robots: { index: false } };

const ERR: Record<string, string> = { INVALID_STATE: "الإجراء ده مش متاح دلوقتي.", NOT_FOUND: "مش لاقيين الحجز." };

async function act(token: string, fn: () => Promise<unknown> | unknown, ok: string) {
  let q = `ok=${encodeURIComponent(ok)}`;
  try {
    await fn();
  } catch (err) {
    q = `err=${encodeURIComponent(err instanceof MarketError ? (ERR[err.code] ?? err.message) : "حصلت مشكلة")}`;
  }
  revalidatePath(`/trips/${token}`);
  redirect(`/trips/${token}?${q}`);
}

async function checkInAction(f: FormData) {
  "use server";
  const t = String(f.get("t"));
  await act(t, () => guestCheckIn(db(), t), "أهلًا بيك! المبلغ هيتحوّل للمالك، واستمتع بإقامتك.");
}
async function issueAction(f: FormData) {
  "use server";
  const t = String(f.get("t"));
  const b = bookingByToken(db(), t);
  await act(t, () => openIssue(db(), b!.id, "guest", String(f.get("type")) as "not_as_described", String(f.get("description") ?? "")), "وصلنا البلاغ. المبلغ اتوقف لحد ما فريقنا يراجع ويكلمك.");
}
async function cancelAction(f: FormData) {
  "use server";
  const t = String(f.get("t"));
  const b = bookingByToken(db(), t);
  await act(t, () => cancelBooking(db(), b!.id, "guest"), "تم إلغاء الحجز.");
}
async function reviewAction(f: FormData) {
  "use server";
  const t = String(f.get("t"));
  await act(t, () => addReview(db(), t, Number(f.get("rating")), String(f.get("text") ?? "")), "شكرًا على تقييمك!");
}
async function demoCheckoutAction(f: FormData) {
  "use server";
  const t = String(f.get("t"));
  await act(t, () => demoCheckout(db(), t), "(تجريبي) تم الخروج ورجوع التأمين.");
}

export default async function TripPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const d = db();
  const b = bookingByToken(d, token);
  if (!b) notFound();
  const c = listingCard(d, b.listing_id)!;
  const s = settings(d);
  const paid = ["confirmed", "checked_in", "completed", "disputed"].includes(b.status);
  const review = get<{ rating: number }>(d, "SELECT rating FROM reviews WHERE booking_id = ? AND author_side = 'guest'", b.id);
  const issue = get<{ status: string; type: string }>(d, "SELECT status, type FROM issues WHERE booking_id = ? ORDER BY id DESC LIMIT 1", b.id);
  const deposit = get<{ status: string; mode: string }>(d, "SELECT status, mode FROM deposit_holds WHERE booking_id = ?", b.id);
  const now = new Date();
  const share = b.status === "confirmed" ? refundShare(b.policy, checkInTime(d, b, s), now) : 0;
  const refundPreview = Math.round(b.nights_total * share) + (share === 1 ? b.service_fee : 0);
  const nights = (JSON.parse(b.nightly_json) as unknown[]).length;
  const handover = c.handover_phone_enc ? localFormat(decryptField(c.handover_phone_enc)) : "";
  const stepDone = [paid, b.status !== "confirmed" && paid, ["checked_in", "completed"].includes(b.status), b.status === "completed"];

  return (
    <main className="lp">
      {b.status === "pending_payment" || b.status === "hold" ? <AutoRefresh seconds={3} /> : null}
      <div className="lp-body" style={{ paddingTop: 28 }}>
        <Flash ok={sp.ok} err={sp.err} />
        <div className="done-icon">
          <Icon name={paid ? "check" : "clock"} size={38} style={{ color: "var(--sea)" }} />
        </div>
        <h1 style={{ textAlign: "center", fontWeight: 700, fontSize: 24, margin: 0 }}>
          {b.status === "cancelled" ? "الحجز ملغي" : paid ? (b.status === "completed" ? "شكرًا لإقامتك" : "الحجز مؤكد") : "بنستنى تأكيد الدفع…"}
        </h1>
        <div className="muted" style={{ textAlign: "center" }}>
          {fmtRange(b.check_in, b.check_out)} · {nightsWord(nights)} · {c.title_ar}
          <br />
          رقم الحجز <span dir="ltr">{b.ref}</span>
        </div>

        {paid ? (
          <div className="steps">
            {[
              "فلوسك محفوظة عندنا لحد يوم الوصول.",
              "قبل الوصول بيوم هيوصلك اللوكيشن ورقم المسؤول عن الاستلام على واتساب.",
              `بعد ما تدخل تضغط «استلمت الشاليه» أو تبلغنا بأي مشكلة خلال ${ar(s.payout_release_hours)} ساعات.`,
              "التأمين بيرجع بعد الخروج، وتقدر تقيّم إقامتك.",
            ].map((t, i) => (
              <div key={i} className={stepDone[i] ? "done" : ""}>
                <b>{stepDone[i] ? "✓" : ar(i + 1)}</b>
                <span>{t}</span>
              </div>
            ))}
          </div>
        ) : null}

        {paid && b.status !== "completed" ? (
          <div className="breakdown">
            <div style={{ fontWeight: 800 }}>تفاصيل الوصول</div>
            <div>العنوان: {c.address_private}</div>
            <div>
              المسؤول عن الاستلام: {c.handover_name} · <a href={`tel:${handover}`} dir="ltr">{ar(handover)}</a>
            </div>
            <a href={`https://maps.google.com/?q=${c.lat},${c.lng}`} target="_blank" rel="noopener" style={{ fontWeight: 700 }}>
              اللوكيشن على الخريطة
            </a>
            <div className="muted" style={{ fontSize: 13 }}>
              الدخول من {ar(s.checkin_hour > 12 ? s.checkin_hour - 12 : s.checkin_hour)} العصر · الخروج {ar(s.checkout_hour)} الظهر · {c.house_rules_ar}
            </div>
          </div>
        ) : null}

        <div className="breakdown">
          <div className="line">
            <span>المدفوع</span>
            <span>{fmtMoney(b.total)}</span>
          </div>
          <div className="line">
            <span>التأمين المسترد</span>
            <span>
              {fmtMoney(b.security_deposit)} ·{" "}
              {deposit ? (deposit.status === "released" ? <span className="tag ok">رجع</span> : deposit.status === "captured" ? <span className="tag bad">اتخصم جزء</span> : <span className="tag warn">محجوز</span>) : "—"}
            </span>
          </div>
          {b.refund_amount ? (
            <div className="line" style={{ color: "var(--success)" }}>
              <span>المسترد</span>
              <span>{fmtMoney(b.refund_amount)}</span>
            </div>
          ) : null}
        </div>

        {b.status === "confirmed" ? (
          <form action={checkInAction}>
            <input type="hidden" name="t" value={token} />
            <button className="pill sea lg" style={{ width: "100%" }} type="submit">
              استلمت الشاليه
            </button>
            {s.demo ? (
              <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
                (نسخة تجريبية: الزر شغال قبل يوم الوصول عشان تجرب الرحلة كاملة)
              </div>
            ) : null}
          </form>
        ) : null}
        {b.status === "checked_in" && s.demo ? (
          <form action={demoCheckoutAction}>
            <input type="hidden" name="t" value={token} />
            <button className="pill" style={{ width: "100%" }} type="submit">
              (تجريبي) محاكاة الخروج ورجوع التأمين
            </button>
          </form>
        ) : null}

        {["confirmed", "checked_in", "completed", "disputed"].includes(b.status) && issue?.status !== "open" ? (
          <details className="card" style={{ padding: 14 }}>
            <summary style={{ fontWeight: 800, cursor: "pointer", minHeight: 32 }}>بلّغ عن مشكلة</summary>
            <form action={issueAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <input type="hidden" name="t" value={token} />
              <label className="field">
                نوع المشكلة
                <select name="type">
                  <option value="not_as_described">الوحدة مش زي الصور</option>
                  <option value="access">مشكلة في الاستلام / الدخول</option>
                  <option value="other">حاجة تانية</option>
                </select>
              </label>
              <label className="field">
                التفاصيل
                <textarea name="description" required minLength={5} rows={3} />
              </label>
              <button className="pill danger" type="submit">
                ابعت البلاغ (المبلغ هيتوقف لحد المراجعة)
              </button>
            </form>
          </details>
        ) : issue?.status === "open" ? (
          <div className="flash" style={{ background: "var(--warn-tint)", color: "var(--warn-ink)" }}>
            فيه بلاغ مفتوح، وفريقنا بيراجعه. المبلغ متوقف لحد الحل.
          </div>
        ) : null}

        {b.status === "completed" && !review ? (
          <form action={reviewAction} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="t" value={token} />
            <div style={{ fontWeight: 800 }}>قيّم إقامتك</div>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 8 }}>
              <legend className="sr-only">التقييم</legend>
              {[5, 4, 3, 2, 1].map((n) => (
                <label key={n} className="check">
                  <input type="radio" name="rating" value={n} defaultChecked={n === 5} required /> {"★".repeat(n)}
                </label>
              ))}
            </fieldset>
            <label className="field">
              رأيك
              <textarea name="text" rows={3} maxLength={1000} />
            </label>
            <button className="pill sea" type="submit">
              انشر التقييم
            </button>
          </form>
        ) : review ? (
          <div className="flash ok">تقييمك اتنشر ({"★".repeat(review.rating)}). شكرًا!</div>
        ) : null}

        {b.status === "confirmed" ? (
          <details className="card" style={{ padding: 14 }}>
            <summary style={{ fontWeight: 800, cursor: "pointer", minHeight: 32 }}>إلغاء الحجز</summary>
            <p style={{ margin: "8px 0" }}>
              سياسة الإلغاء: <b>{POLICY_TEXT[b.policy].name}</b>. {POLICY_TEXT[b.policy].text}
              <br />
              لو لغيت دلوقتي هيرجع لك <b>{fmtMoney(refundPreview)}</b>.
            </p>
            <form action={cancelAction}>
              <input type="hidden" name="t" value={token} />
              <button className="pill danger" type="submit">
                تأكيد الإلغاء
              </button>
            </form>
          </details>
        ) : null}
        <Link href="/" className="pill" prefetch={false}>
          رجوع
        </Link>
      </div>
    </main>
  );
}
