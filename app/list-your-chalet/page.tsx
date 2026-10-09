import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { get, run, transaction } from "@/lib/db";
import { encryptField, hashPassword } from "@/lib/crypto";
import { normalizeEgyptianMobile } from "@/lib/phone";
import { SiteFooter, SiteHeader, Flash } from "@/components/ui";
import { ar } from "@/market/format";
import { audit, settings } from "@/market/repo";
import { db } from "@/server/db";
import { createSession } from "@/server/session";

export const metadata: Metadata = { title: "اعرض شاليهك" };

/** Owner onboarding step 1: account. Identity, payout details, plan and agreement follow in /owner/verification. */
async function register(f: FormData) {
  "use server";
  const name = String(f.get("name") ?? "").trim();
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const phone = normalizeEgyptianMobile(String(f.get("phone") ?? ""));
  const password = String(f.get("password") ?? "");
  if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || !phone || password.length < 8) redirect("/list-your-chalet?err=" + encodeURIComponent("راجع البيانات: الاسم، الإيميل، رقم موبايل مصري، وكلمة مرور ٨ حروف على الأقل."));
  if (get(db(), "SELECT 1 FROM users WHERE email = ?", email)) redirect("/list-your-chalet?err=" + encodeURIComponent("الإيميل ده مسجل بالفعل. ادخل من صفحة الدخول."));
  const uid = transaction(db(), () => {
    const id = run(db(), "INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?, 'owner')", name, email, hashPassword(password)).id;
    run(db(), "INSERT INTO owners (user_id, display_name, phone_enc, plan) VALUES (?,?,?,?)", id, name, encryptField(phone), f.get("plan") === "managed" ? "managed" : "commission");
    audit(db(), { userId: id, name }, "owner.registered", "user", id);
    return id;
  });
  await createSession(uid);
  redirect("/owner/verification");
}

export default async function ListYourChalet({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const s = settings(db());
  return (
    <>
      <SiteHeader brand={s.brand_ar} />
      <main className="wrap" style={{ paddingBlock: 40, maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ margin: 0 }}>املا شاليهك في الموسم الهادي، من غير حجز مزدوج</h1>
        <ol style={{ margin: 0, paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>سجّل حسابك وأكّد هويتك وبيانات التحويل.</li>
          <li>فريقنا بيزور الوحدة ويصورها مجانًا ويراجع قائمة الفحص.</li>
          <li>اربط تقويم Airbnb وBooking.com، وحدّد أسعارك ومواسمك.</li>
          <li>فلوس كل حجز بتتحوّل لك بعد وصول الضيف بـ {ar(s.payout_release_hours)} ساعات لو مفيش بلاغ.</li>
        </ol>
        <Flash err={err} />
        <form action={register} className="card form-grid" style={{ padding: 18 }}>
          <label className="field">
            الاسم
            <input name="name" required minLength={3} autoComplete="name" />
          </label>
          <label className="field">
            الموبايل
            <input name="phone" required inputMode="tel" dir="ltr" style={{ textAlign: "right" }} />
          </label>
          <label className="field">
            الإيميل
            <input name="email" type="email" required dir="ltr" autoComplete="email" />
          </label>
          <label className="field">
            كلمة المرور
            <input name="password" type="password" required minLength={8} dir="ltr" autoComplete="new-password" />
          </label>
          <fieldset className="full" style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <legend style={{ fontWeight: 800, marginBottom: 6 }}>اختار الخطة</legend>
            <label className="check">
              <input type="radio" name="plan" value="commission" defaultChecked /> عمولة على الحجز ({ar(s.commission_pct)}٪): إنت بتستلم الضيوف بنفسك
            </label>
            <label className="check">
              <input type="radio" name="plan" value="managed" /> إدارة كاملة ({ar(s.managed_pct)}٪): فريقنا بيستلم ويسلّم ويتابع النظافة
            </label>
          </fieldset>
          <button className="pill dark lg full" type="submit">
            سجّل وحدتك
          </button>
        </form>
        <p className="muted" style={{ margin: 0 }}>
          عندك حساب؟ <Link href="/login">ادخل من هنا</Link>
        </p>
      </main>
      <SiteFooter brand={s.brand_ar} phone={s.support_phone} />
    </>
  );
}
