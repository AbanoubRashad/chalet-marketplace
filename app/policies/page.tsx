import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ui";
import { ar } from "@/market/format";
import { settings } from "@/market/repo";
import { POLICY_TEXT } from "@/market/types";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "السياسات والشروط والخصوصية" };

export default function Policies() {
  const s = settings(db());
  return (
    <>
      <SiteHeader brand={s.brand_ar} />
      <main className="wrap" style={{ paddingBlock: 40, maxWidth: 860, display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ margin: 0 }}>السياسات</h1>
        <h2 id="cancellation">سياسات الإلغاء</h2>
        {Object.values(POLICY_TEXT).map((p) => (
          <p key={p.name} style={{ margin: 0 }}>
            <b>{p.name}:</b> {p.text}
          </p>
        ))}
        <p style={{ margin: 0 }}>رسوم الخدمة ({ar(s.service_fee_pct)}٪) بترجع بس مع الاسترداد الكامل. لو المالك أو المنصة لغت الحجز بيرجع المبلغ كامل.</p>
        <h2 id="terms">شروط الحجز</h2>
        <p style={{ margin: 0 }}>
          المبلغ بيفضل محفوظ عند المنصة ومش بيتحوّل للمالك غير بعد ما تضغط «استلمت الشاليه» أو بعد {ar(s.payout_release_hours)} ساعات من موعد الوصول لو مفيش بلاغ. التأمين المسترد بيرجع خلال {ar(s.deposit_return_days)} أيام من الخروج إلا لو المالك بلّغ عن تلفيات، وساعتها فريقنا بيراجع الدليل قبل أي خصم.
        </p>
        <h2 id="privacy">الخصوصية</h2>
        <p style={{ margin: 0 }}>
          بنطلب أقل بيانات ممكنة: الاسم والموبايل ونتيجة التحقق من الهوية (مش صورة البطاقة). العنوان التفصيلي ورقم المسؤول عن الاستلام بيظهروا بس بعد تأكيد الدفع، ورقمك مش بيظهر للمالك قبل الحجز. الرسائل بتكون من خلال المنصة.
        </p>
      </main>
      <SiteFooter brand={s.brand_ar} phone={s.support_phone} />
    </>
  );
}
