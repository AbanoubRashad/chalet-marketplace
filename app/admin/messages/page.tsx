import { all } from "@/lib/db";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

const T: Record<string, string> = {
  booking_confirmed: "تأكيد الحجز",
  arrival_details: "تفاصيل الوصول",
  checkin_prompt: "طلب تأكيد الاستلام",
  checkout_reminder: "تذكير الخروج",
  deposit_returned: "رجوع التأمين",
  review_request: "طلب تقييم",
  booking_cancelled: "إلغاء",
  owner_new_booking: "حجز جديد للمالك",
};

export default async function Messages() {
  await requireRole(["admin"]);
  const rows = all<{ id: number; template: string; recipient: string; body: string; status: string; created_at: string; channel: string }>(db(), "SELECT * FROM message_log ORDER BY id DESC LIMIT 100");
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>الرسائل</h1>
          <div className="muted">{process.env.WHATSAPP_TOKEN ? "متصل بـ WhatsApp Business" : "وضع تجريبي: الرسائل بتتسجل هنا بدل ما تتبعت (قوالب واتساب معتمدة مطلوبة للإطلاق)."}</div>
        </div>
      </div>
      <section className="panel">
        {rows.length === 0 ? <div className="muted">مفيش رسائل لسه.</div> : null}
        {rows.map((m) => (
          <div key={m.id} className="row-line" style={{ alignItems: "flex-start", flexDirection: "column" }}>
            <span style={{ fontSize: 13 }}>
              <b>{T[m.template] ?? m.template}</b> · <span dir="ltr">{m.recipient}</span> · <span className="tag">{m.status}</span> · <span className="muted">{m.created_at.slice(0, 16).replace("T", " ")}</span>
            </span>
            <span style={{ background: "#E6F4EA", borderRadius: 12, padding: "8px 12px" }}>{m.body}</span>
          </div>
        ))}
      </section>
    </>
  );
}
