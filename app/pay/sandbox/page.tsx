import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { get } from "@/lib/db";
import { secret } from "@/lib/crypto";
import { computeTransactionHmac, paymobConfigFromEnv, sandboxTransaction } from "@/payments/paymob";
import { bookingByToken, listingCard } from "@/market/repo";
import { fmtMoney, fmtRange } from "@/market/format";
import { db } from "@/server/db";
import { originOf } from "@/server/api";

export const dynamic = "force-dynamic";

function load(p?: string, t?: string) {
  if (paymobConfigFromEnv() || !p || !t) notFound();
  const b = bookingByToken(db(), t);
  const pay = get<{ id: number; booking_id: number; method: "card" | "wallet"; amount_cents: number; status: string; provider_order_id: string }>(db(), "SELECT * FROM payments WHERE id = ?", Number(p));
  if (!b || !pay || pay.booking_id !== b.id) notFound();
  return { b, pay };
}

/** Plays Paymob's part locally: signs the transaction callback with the HMAC secret and POSTs it to our webhook. */
async function simulate(f: FormData) {
  "use server";
  const { b, pay } = load(String(f.get("p")), String(f.get("t")));
  const txn = sandboxTransaction({ id: Date.now(), orderId: 800000 + pay.id, merchantOrderId: pay.provider_order_id, amountCents: pay.amount_cents, method: pay.method, success: f.get("outcome") === "success" });
  const hmac = computeTransactionHmac(txn, secret("PAYMOB_HMAC_SECRET"));
  const res = await fetch(`${originOf(await headers())}/api/payments/paymob/webhook?hmac=${hmac}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "TRANSACTION", obj: txn }) });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  redirect(`/trips/${b.public_token}`);
}

export default async function Sandbox({ searchParams }: { searchParams: Promise<{ p?: string; t?: string }> }) {
  const { p, t } = await searchParams;
  const { b, pay } = load(p, t);
  const c = listingCard(db(), b.listing_id)!;
  const open = pay.status === "initiated" && b.status === "pending_payment";
  const Btn = ({ outcome, label, cls }: { outcome: string; label: string; cls: string }) => (
    <form action={simulate}>
      <input type="hidden" name="p" value={pay.id} />
      <input type="hidden" name="t" value={b.public_token} />
      <input type="hidden" name="outcome" value={outcome} />
      <button className={`pill lg ${cls}`} style={{ width: "100%" }} type="submit">
        {label}
      </button>
    </form>
  );
  return (
    <main className="login-wrap">
      <div className="panel">
        <div className="flash" style={{ background: "var(--warn-tint)", color: "var(--warn-ink)", fontSize: 14 }}>
          صفحة دفع تجريبية بتحاكي Paymob. مفيش فلوس حقيقية.
        </div>
        <h1 style={{ margin: 0, fontSize: 22 }}>دفع حجز · {pay.method === "card" ? "بطاقة بنكية" : "محفظة موبايل"}</h1>
        <div className="breakdown">
          <div>{c.title_ar}</div>
          <div className="muted">{fmtRange(b.check_in, b.check_out)} · {b.ref}</div>
          <div className="line" style={{ fontWeight: 800 }}>
            <span>المبلغ</span>
            <span>{fmtMoney(pay.amount_cents / 100)}</span>
          </div>
          {pay.method === "card" ? <div className="muted" style={{ fontSize: 13 }}>+ تفويض تأمين {fmtMoney(b.security_deposit)} على الكارت (مش بيتخصم)</div> : null}
        </div>
        {open ? (
          <>
            <Btn outcome="success" label="ادفع (عملية ناجحة)" cls="sea" />
            <Btn outcome="declined" label="رفض العملية" cls="" />
          </>
        ) : (
          <div className="flash ok">العملية دي اتقفلت بالفعل.</div>
        )}
      </div>
    </main>
  );
}
