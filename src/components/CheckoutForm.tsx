"use client";

import { useEffect, useState } from "react";
import { ar } from "@/market/format";

const ERR: Record<string, string> = {
  INVALID_PHONE: "اكتب رقم موبايل مصري صحيح.",
  INVALID_NAME: "اكتب الاسم بالكامل.",
  ID_REQUIRED: "محتاجين التحقق من الهوية قبل أول حجز.",
  ID_FAILED: "رقم الهوية مش صحيح. راجع الرقم القومي (١٤ رقم) أو رقم الباسبور.",
  HOLD_EXPIRED: "انتهت مدة حجز التواريخ. ارجع واختارها تاني.",
  RATE_LIMITED: "محاولات كتير، استنى دقيقة.",
};

export function CheckoutForm({ token, expiresAt, needsId, total, deposit }: { token: string; expiresAt: string; needsId: boolean; total: string; deposit: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [method, setMethod] = useState<"card" | "wallet">("card");
  const [idType, setIdType] = useState<"national_id" | "passport">("national_id");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Date.parse(expiresAt) - now);
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/holds/${token}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.get("name"), phone: f.get("phone"), email: f.get("email"), idType, idNumber: f.get("idNumber"), method }),
    });
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (j.url) window.location.assign(j.url);
    else {
      setError(j.error ?? "generic");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className={`flash ${left ? "ok" : "err"}`} aria-live="polite" style={{ background: left ? "var(--sea-tint)" : undefined, color: left ? "var(--sea-dark)" : undefined }}>
        {left ? `التواريخ محجوزة ليك لمدة ${ar(mmss)}` : "انتهت مدة حجز التواريخ، ارجع واختارها تاني."}
      </div>
      <label className="field">
        الاسم بالكامل
        <input name="name" required minLength={3} autoComplete="name" />
      </label>
      <label className="field">
        رقم الموبايل (واتساب)
        <input name="phone" required inputMode="tel" autoComplete="tel-national" dir="ltr" placeholder="01xxxxxxxxx" style={{ textAlign: "right" }} />
        <span className="hint">بيوصلك عليه التأكيد واللوكيشن قبل الوصول بيوم. رقمك مش بيظهر للمالك.</span>
      </label>
      <label className="field">
        الإيميل (اختياري)
        <input name="email" type="email" autoComplete="email" dir="ltr" />
      </label>
      {needsId ? (
        <fieldset className="card" style={{ padding: 14, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <legend style={{ fontWeight: 800, padding: "0 6px" }}>التحقق من الهوية (مرة واحدة)</legend>
          <div className="seg" role="group" aria-label="نوع الهوية" style={{ alignSelf: "flex-start" }}>
            <button type="button" aria-pressed={idType === "national_id"} onClick={() => setIdType("national_id")}>
              رقم قومي
            </button>
            <button type="button" aria-pressed={idType === "passport"} onClick={() => setIdType("passport")}>
              باسبور
            </button>
          </div>
          <label className="field">
            {idType === "national_id" ? "الرقم القومي (١٤ رقم)" : "رقم الباسبور"}
            <input name="idNumber" required inputMode={idType === "national_id" ? "numeric" : "text"} dir="ltr" style={{ textAlign: "right" }} autoComplete="off" />
            <span className="hint">بنحفظ نتيجة التحقق وآخر ٤ أرقام بس، مش صورة البطاقة ولا الرقم كامل.</span>
          </label>
        </fieldset>
      ) : null}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ fontWeight: 800, marginBottom: 8 }}>طريقة الدفع</legend>
        {(
          [
            ["card", "بطاقة بنكية (ميزة / فيزا)", `التأمين ${deposit} بيتحجز على الكارت ومش بيتخصم`],
            ["wallet", "فودافون كاش / محفظة", `بيتدفع التأمين ${deposit} مع الحجز ويرجع لك بعد الخروج`],
          ] as const
        ).map(([m, label, hint]) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className="card" style={{ minHeight: 56, padding: "8px 14px", textAlign: "start", border: method === m ? "2px solid var(--sea)" : undefined, background: method === m ? "#F5F9FC" : "#fff" }}>
            <b>{label}</b>
            <div className="muted" style={{ fontSize: 13 }}>
              {hint}
            </div>
          </button>
        ))}
      </fieldset>
      {error ? (
        <div className="flash err" role="alert">
          {ERR[error] ?? "حصلت مشكلة، جرّب تاني."}
        </div>
      ) : null}
      <div className="muted" style={{ fontSize: 13 }}>
        بالدفع إنت موافق على سياسة الإلغاء وشروط المنصة. المبلغ بيفضل محفوظ عندنا ومش بيتحوّل للمالك غير بعد ما تستلم الشاليه.
      </div>
      <button className="pill sea lg" type="submit" disabled={busy || !left} aria-busy={busy}>
        {busy ? "…" : `ادفع ${total}`}
      </button>
    </form>
  );
}
