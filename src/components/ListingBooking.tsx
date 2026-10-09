"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import { ar, fmtMonth, fmtNum, fmtRange, nightsWord, TIER_AR } from "@/market/format";

type Day = { date: string; amount: number; tier: "regular" | "weekend" | "season"; minNights: number; blocked: boolean; past: boolean };
type Quote = {
  nights: { date: string; amount: number; tier: Day["tier"] }[];
  tiers: { tier: Day["tier"]; count: number; amount: number }[];
  subtotal: number;
  discount: number;
  discountLabel: string | null;
  nightsTotal: number;
  serviceFee: number;
  total: number;
  deposit: number;
  feePct: number;
  minNights: number;
  meetsMinNights: boolean;
};

const ERR: Record<string, string> = {
  DATES_TAKEN: "التواريخ دي اتحجزت حالًا. اختار تواريخ تانية.",
  MIN_NIGHTS: "أقل مدة للتواريخ دي أكتر من اختيارك.",
  TOO_MANY_GUESTS: "عدد الأفراد أكبر من سعة الوحدة.",
  NOT_BOOKABLE: "الوحدة مش متاحة للحجز حاليًا.",
  INVALID_DATES: "اختار تواريخ صحيحة.",
  RATE_LIMITED: "محاولات كتير، استنى دقيقة.",
};

function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function ListingBooking(p: {
  listingId: number;
  capacity: number;
  policyName: string;
  policyText: string;
  releaseHours: number;
  firstMonth: string;
  initialMonth: string;
  initialDays: Day[];
  initialIn?: string;
  initialOut?: string;
  initialGuests: number;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(p.initialMonth);
  const [days, setDays] = useState<Day[]>(p.initialDays);
  const [a, setA] = useState<string | null>(p.initialIn ?? null);
  const [b, setB] = useState<string | null>(p.initialOut ?? null);
  const [guests, setGuests] = useState(Math.min(p.initialGuests, p.capacity));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (month === p.initialMonth) {
      setDays(p.initialDays);
      return;
    }
    let live = true;
    fetch(`/api/listings/${p.listingId}/calendar?month=${month}`)
      .then((r) => r.json())
      .then((j: { days?: Day[] }) => live && j.days && setDays(j.days));
    return () => {
      live = false;
    };
  }, [month, p.listingId, p.initialMonth, p.initialDays]);

  useEffect(() => {
    setQuote(null);
    if (!a || !b) return;
    let live = true;
    fetch(`/api/listings/${p.listingId}/quote?in=${a}&out=${b}`)
      .then((r) => r.json())
      .then((j: { quote?: Quote; available?: boolean; error?: string }) => {
        if (!live) return;
        if (j.quote) {
          setQuote(j.quote);
          setAvailable(Boolean(j.available));
        } else setError(j.error ?? "INVALID_DATES");
      });
    return () => {
      live = false;
    };
  }, [a, b, p.listingId]);

  const blockedSet = useMemo(() => new Set(days.filter((d) => d.blocked).map((d) => d.date)), [days]);
  const lead = useMemo(() => {
    const first = days[0]?.date;
    if (!first) return 0;
    const [y, m, d] = first.split("-").map(Number) as [number, number, number];
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7; // grid starts on Saturday
  }, [days]);

  function pick(day: Day) {
    setError(null);
    if (!a || b || day.date <= a) {
      if (day.blocked) return;
      setA(day.date);
      setB(null);
      return;
    }
    // every night between check-in and this check-out must be free (the check-out day itself may be taken)
    for (const d of days) if (d.date >= a && d.date < day.date && d.blocked) {
      if (!day.blocked) {
        setA(day.date);
        setB(null);
      }
      return;
    }
    setB(day.date);
  }

  async function book() {
    if (!a || !b || !quote) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: p.listingId, checkIn: a, checkOut: b, guests }) });
    const j = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (j.token) router.push(`/book/${j.token}`);
    else {
      setError(j.error ?? "generic");
      setBusy(false);
      if (j.error === "DATES_TAKEN") {
        setB(null);
        fetch(`/api/listings/${p.listingId}/calendar?month=${month}`)
          .then((r) => r.json())
          .then((x: { days?: Day[] }) => x.days && setDays(x.days));
      }
    }
  }

  const nights = quote?.nights.length ?? 0;
  const ok = Boolean(quote && available && quote.meetsMinNights);

  return (
    <>
      <div className="lp-body" style={{ paddingTop: 0 }}>
        <div className="month-nav">
          <span style={{ fontWeight: 800 }}>اختار التواريخ</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" className="icon-btn" aria-label="الشهر السابق" disabled={month <= p.firstMonth} onClick={() => setMonth(addMonths(month, -1))}>
              <Icon name="back" />
            </button>
            <span className="muted" style={{ fontSize: 13, minWidth: 90, textAlign: "center" }} aria-live="polite">
              {fmtMonth(month)}
            </span>
            <button type="button" className="icon-btn" aria-label="الشهر التالي" disabled={month >= addMonths(p.firstMonth, 12)} onClick={() => setMonth(addMonths(month, 1))}>
              <Icon name="next" />
            </button>
          </span>
        </div>
        <div className="cal-head" aria-hidden="true">
          {["سبت", "أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"].map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="cal" role="group" aria-label={`أيام ${fmtMonth(month)}`}>
          {Array.from({ length: lead }, (_, i) => (
            <span key={`pad${i}`} className="day pad" />
          ))}
          {days.map((d) => {
            const edge = d.date === a || d.date === b;
            const mid = a && b && d.date > a && d.date < b;
            const canBeCheckout = Boolean(a && !b && d.date > a);
            const disabled = d.past || (d.blocked && !canBeCheckout);
            const n = Number(d.date.slice(8));
            return (
              <button
                key={d.date}
                type="button"
                className={`day${edge ? " edge" : mid ? " mid" : ""}${d.past ? " past" : ""}`}
                disabled={disabled}
                aria-pressed={edge || Boolean(mid)}
                aria-label={`${ar(n)} ${fmtMonth(month)} · ${d.blocked ? "محجوز" : `${TIER_AR[d.tier].name} ${fmtNum(d.amount)} ج.م`}`}
                onClick={() => pick(d)}
              >
                <b>{ar(n)}</b>
                <small>{d.blocked ? "—" : TIER_AR[d.tier].short}</small>
              </button>
            );
          })}
        </div>
        <div className="legend">
          <span>ع = سعر عادي</span>
          <span>و = ويك إند</span>
          <span>م = موسم/أعياد</span>
          <span>مشطوب = محجوز</span>
        </div>

        <div className="breakdown" aria-live="polite">
          {!a || !b ? (
            <div className="muted">{a ? "اختار يوم المغادرة." : "اضغط يوم الوصول، وبعدين يوم المغادرة."}</div>
          ) : !quote ? (
            <div className="muted">بنحسب السعر…</div>
          ) : (
            <>
              <div style={{ fontWeight: 800 }}>
                من {fmtRange(a, b)} · {nightsWord(nights)}
              </div>
              {quote.tiers.map((t) => (
                <div className="line" key={t.tier}>
                  <span>
                    {ar(t.count)} × {TIER_AR[t.tier].name}
                  </span>
                  <span>{fmtNum(t.amount)} ج.م</span>
                </div>
              ))}
              {quote.discount ? (
                <div className="line" style={{ color: "var(--success)" }}>
                  <span>{quote.discountLabel}</span>
                  <span>− {fmtNum(quote.discount)} ج.م</span>
                </div>
              ) : null}
              <div className="line">
                <span>رسوم الخدمة ({ar(quote.feePct)}٪)</span>
                <span>{fmtNum(quote.serviceFee)} ج.م</span>
              </div>
              <div className="line" style={{ fontWeight: 800 }}>
                <span>الإجمالي</span>
                <span>{fmtNum(quote.total)} ج.م</span>
              </div>
              {quote.deposit ? (
                <div className="line muted">
                  <span>تأمين مسترد (يُحجز على الكارت)</span>
                  <span>{fmtNum(quote.deposit)} ج.م</span>
                </div>
              ) : null}
              {!quote.meetsMinNights ? <div style={{ color: "var(--danger)", fontWeight: 700 }}>أقل مدة للتواريخ دي {nightsWord(quote.minNights)}.</div> : null}
              {!available ? <div style={{ color: "var(--danger)", fontWeight: 700 }}>فيه ليالي محجوزة في الفترة دي.</div> : null}
            </>
          )}
          <label className="field" style={{ marginTop: 6 }}>
            عدد الأفراد
            <select value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
              {Array.from({ length: p.capacity }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {ar(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? (
          <div className="flash err" role="alert">
            {ERR[error] ?? "حصلت مشكلة، جرّب تاني."}
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: 13 }}>
          <b style={{ color: "var(--ink)" }}>سياسة الإلغاء: {p.policyName}.</b> {p.policyText} المبلغ بيتحوّل للمالك بعد تسجيل دخولك أو بعد {ar(p.releaseHours)} ساعات من موعد الوصول لو مفيش بلاغ.
        </div>
      </div>
      <div className="sticky-cta">
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
          <span style={{ fontWeight: 800 }}>{quote && a && b ? `${nightsWord(nights)} · ${fmtNum(quote.total)} ج.م` : "اختار التواريخ"}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            الدفع محمي
          </span>
        </div>
        <button type="button" onClick={book} disabled={!ok || busy} aria-busy={busy}>
          {busy ? "…" : "احجز الآن"}
        </button>
      </div>
    </>
  );
}
