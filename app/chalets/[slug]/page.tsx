import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { todayIn } from "@/booking-engine";
import { ListingBooking } from "@/components/ListingBooking";
import { Icon } from "@/components/ui";
import { monthDays } from "@/market/calendar";
import { ar, fmtDateShort, fmtRating } from "@/market/format";
import { listingCard, photos, settings } from "@/market/repo";
import { POLICY_TEXT } from "@/market/types";
import { db } from "@/server/db";
import { currentUser } from "@/server/session";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const d = db();
  const c = listingCard(d, decodeURIComponent(slug));
  if (!c) notFound();
  const s = settings(d);
  const user = await currentUser();
  const visible = c.status === "live" && (s.launched || user?.role === "admin");
  if (!visible && !(user && (user.role === "admin" || user.role === "inspector"))) notFound();
  return { d, c, s };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { c } = await load((await params).slug);
  return { title: c.title_ar, description: `${c.title_ar} · ${c.region_ar} كم ${c.km_marker} · ${c.capacity} أفراد · زرناها وصورناها والدفع محمي لحد الوصول.` };
}

export default async function ListingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { d, c, s } = await load((await params).slug);
  const sp = await searchParams;
  const pics = photos(d, c.id);
  const today = todayIn(s.timezone);
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today ? v : undefined);
  const checkIn = valid(sp.in);
  const checkOut = valid(sp.out) && checkIn && sp.out! > checkIn ? sp.out : undefined;
  const firstMonth = today.slice(0, 7);
  const month = (checkIn ?? today).slice(0, 7);
  const reviews = all<{ author_name: string; rating: number; text: string; reply: string | null; created_at: string }>(
    d,
    "SELECT author_name, rating, text, reply, created_at FROM reviews WHERE listing_id = ? AND author_side = 'guest' ORDER BY created_at DESC LIMIT 3",
    c.id,
  );
  const lastVisit = pics[0]?.taken_on;

  return (
    <main className="lp">
      <div className="gallery">
        {pics[0] ? <Image src={pics[0].url} alt={c.title_ar} width={560} height={260} priority sizes="(max-width: 560px) 100vw, 560px" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        <div className="thumbs">
          {pics.slice(1, 3).map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener" aria-label="صورة أكبر">
              <img src={p.url} alt="" />
            </a>
          ))}
          {pics.length > 3 ? <span>+{ar(pics.length - 3)}</span> : null}
        </div>
        <Link href={`/?in=${checkIn ?? ""}&out=${checkOut ?? ""}`} className="round-btn" aria-label="رجوع" prefetch={false}>
          <Icon name="back" />
        </Link>
      </div>
      <div className="lp-body">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontWeight: 700, fontSize: 22 }}>{c.title_ar}</h1>
          <div className="muted" style={{ fontSize: 14 }}>
            {c.region_ar} · كم {ar(c.km_marker ?? 0)} · {c.location_note_ar}
          </div>
          {c.reviews ? (
            <div style={{ fontSize: 14 }}>
              ★ {fmtRating(c.rating)} · {ar(c.reviews)} تقييم من ضيوف سكنوا فعلًا
            </div>
          ) : null}
        </div>
        <div className="cap-grid">
          <div>
            <b>{ar(c.capacity)}</b>
            <br />
            أفراد
          </div>
          <div>
            <b>{ar(c.rooms)}</b>
            <br />
            غرف
          </div>
          <div>
            <b>{ar(c.baths)}</b>
            <br />
            حمام
          </div>
          <div>
            <b>{ar(c.parking)}</b>
            <br />
            عربية
          </div>
        </div>
        <div className="verified">
          <Icon name="shield" style={{ color: "var(--sea)", flex: "none" }} />
          زرناها وصورناها{lastVisit ? ` (${fmtDateShort(lastVisit)})` : ""} · المالك متحقق من هويته
        </div>
      </div>
      <ListingBooking
        listingId={c.id}
        capacity={c.capacity}
        policyName={POLICY_TEXT[c.cancellation_policy].name}
        policyText={POLICY_TEXT[c.cancellation_policy].text}
        releaseHours={s.payout_release_hours}
        firstMonth={firstMonth}
        initialMonth={month}
        initialDays={monthDays(d, c.id, month)}
        initialIn={checkIn}
        initialOut={checkOut}
        initialGuests={Number(sp.guests) || 2}
      />
      <section className="lp-body" aria-labelledby="about">
        <h2 id="about" style={{ margin: 0, fontSize: 20 }}>
          عن الوحدة
        </h2>
        <p style={{ margin: 0 }}>{c.description_ar}</p>
        <div className="muted" style={{ fontSize: 14 }}>
          {(JSON.parse(c.amenities) as string[]).join(" · ")}
        </div>
        <div style={{ fontSize: 14 }}>
          <b>قواعد الوحدة:</b> {c.house_rules_ar}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          العنوان بالتفصيل ورقم المسؤول عن الاستلام بيوصلوك بعد تأكيد الدفع، والتواصل بيكون من خلال المنصة.
        </div>
        {reviews.length ? (
          <>
            <h2 style={{ margin: "8px 0 0", fontSize: 20 }}>تقييمات الضيوف</h2>
            {reviews.map((r, i) => (
              <figure key={i} className="card" style={{ margin: 0, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{r.author_name}</strong>
                  <span aria-label={`${r.rating} من ٥`}>{"★".repeat(r.rating)}</span>
                </div>
                <blockquote style={{ margin: 0 }}>{r.text}</blockquote>
                {r.reply ? <div className="muted" style={{ fontSize: 13 }}>رد المالك: {r.reply}</div> : null}
                <span className="tag ok" style={{ alignSelf: "flex-start" }}>
                  إقامة متحقق منها
                </span>
              </figure>
            ))}
          </>
        ) : null}
      </section>
    </main>
  );
}
