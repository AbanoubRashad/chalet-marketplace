import { Flash } from "@/components/ui";
import { fmtDateShort } from "@/market/format";
import { requireOwner } from "@/server/session";
import { verificationAction } from "../actions";

export const dynamic = "force-dynamic";

/** Owner onboarding: identity, payout details, listing agreement. */
export default async function Verification({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { owner } = await requireOwner();
  const steps: [string, boolean][] = [
    ["الحساب", true],
    ["التحقق من الهوية", owner.identity_status === "verified"],
    ["بيانات التحويل", Boolean(owner.payout_masked)],
    ["اتفاقية العرض", Boolean(owner.agreement_signed_at)],
  ];
  return (
    <>
      <div className="dash-top">
        <h1>التحقق والمستندات</h1>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <section className="panel">
        {steps.map(([label, done]) => (
          <div key={label} className="row-line">
            <span>{label}</span>
            <span className={`tag ${done ? "ok" : "warn"}`}>{done ? "تمام" : "مطلوب"}</span>
          </div>
        ))}
        {owner.agreement_signed_at ? <div className="muted">الاتفاقية اتوقّعت يوم {fmtDateShort(owner.agreement_signed_at.slice(0, 10))}.</div> : null}
      </section>
      <form action={verificationAction} className="panel form-grid">
        <input type="hidden" name="back" value="/owner/verification" />
        <label className="field">
          الرقم القومي
          <input name="nid" required inputMode="numeric" dir="ltr" autoComplete="off" />
          <span className="hint">بنتحقق منه عن طريق مزوّد خدمة ونحتفظ بالنتيجة بس.</span>
        </label>
        <label className="field">
          طريقة التحويل
          <select name="method" defaultValue={owner.payout_method ?? "bank"}>
            <option value="bank">حساب بنكي</option>
            <option value="instapay">InstaPay</option>
          </select>
        </label>
        <label className="field">
          رقم الحساب / IBAN / عنوان InstaPay
          <input name="account" required dir="ltr" autoComplete="off" />
        </label>
        <label className="field">
          موبايل المسؤول عن الاستلام (اختياري)
          <input name="handover" inputMode="tel" dir="ltr" />
        </label>
        <label className="check full">
          <input type="checkbox" name="agree" required={!owner.agreement_signed_at} defaultChecked={Boolean(owner.agreement_signed_at)} /> قريت ووافقت على اتفاقية عرض الوحدة (العمولة، الدفع بعد الوصول، المعاينة، سياسات الإلغاء)
        </label>
        <button className="pill dark" type="submit">
          حفظ
        </button>
      </form>
    </>
  );
}
