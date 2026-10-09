import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { Icon } from "@/components/ui";
import { ar, fmtMoney, fmtRange, nightsWord } from "@/market/format";
import { bookingByToken, listingCard, settings } from "@/market/repo";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "إتمام الحجز", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = db();
  const b = bookingByToken(d, token);
  if (!b) notFound();
  if (b.status !== "hold") redirect(`/trips/${token}`);
  const c = listingCard(d, b.listing_id)!;
  const s = settings(d);
  const nights = JSON.parse(b.nightly_json) as { amount: number }[];
  return (
    <main className="lp">
      <div className="lp-body">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link className="icon-btn" href={`/chalets/${c.slug}?in=${b.check_in}&out=${b.check_out}&guests=${b.guests_count}`} aria-label="رجوع" prefetch={false}>
            <Icon name="back" />
          </Link>
          <h1 style={{ margin: 0, fontSize: 22 }}>بياناتك والدفع</h1>
        </div>
        <div className="breakdown">
          <div style={{ fontWeight: 800 }}>{c.title_ar}</div>
          <div className="muted">
            {fmtRange(b.check_in, b.check_out)} · {nightsWord(nights.length)} · {ar(b.guests_count)} أفراد
          </div>
          <div className="line">
            <span>الليالي{b.discount ? " بعد الخصم" : ""}</span>
            <span>{fmtMoney(b.nights_total)}</span>
          </div>
          <div className="line">
            <span>رسوم الخدمة ({ar(s.service_fee_pct)}٪)</span>
            <span>{fmtMoney(b.service_fee)}</span>
          </div>
          <div className="line" style={{ fontWeight: 800 }}>
            <span>الإجمالي</span>
            <span>{fmtMoney(b.total)}</span>
          </div>
          <div className="line muted">
            <span>تأمين مسترد</span>
            <span>{fmtMoney(b.security_deposit)}</span>
          </div>
        </div>
        <CheckoutForm token={token} expiresAt={b.hold_expires_at!} needsId={Boolean(s.require_guest_id)} total={fmtMoney(b.total)} deposit={fmtMoney(b.security_deposit)} />
      </div>
    </main>
  );
}
