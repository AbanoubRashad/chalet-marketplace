import Link from "next/link";
import Image from "next/image";
import { all } from "@/lib/db";
import { addDays, todayIn, weekdayOf } from "@/booking-engine";
import { SiteFooter, SiteHeader } from "@/components/ui";
import { isAvailable, quote } from "@/market/booking";
import { ar, fmtNum, fmtRange, fmtRating, nightsWord } from "@/market/format";
import { listingCards, settings } from "@/market/repo";
import { db } from "@/server/db";
import { currentUser } from "@/server/session";

export const dynamic = "force-dynamic";

const CHIPS: [string, string][] = [
  ["beach", "على البحر مباشرة"],
  ["pool", "بحمام سباحة"],
  ["family", "للعائلات"],
  ["rooms3", "٣ غرف+"],
  ["pets", "مسموح بالحيوانات"],
  ["flex", "إلغاء مرن"],
];
const TRUST = [
  ["وحدات متراجعة", "فريقنا بيزور كل وحدة، يصورها، ويتأكد إن الصور زي الحقيقة."],
  ["دفع محمي", "المبلغ بيتحجز عندنا وبيتحوّل للمالك بعد ما تدخل وتأكد."],
  ["تأمين واضح", "مبلغ تأمين مسترد بيرجع لك خلال ٣ أيام بعد الخروج."],
  ["تقييمات حقيقية", "محدش يقدر يقيّم غير ضيف سكن فعلًا بحجز على المنصة."],
];

/** Next Thursday → Saturday: the default "weekend" search. */
function nextWeekend(today: string) {
  let d = addDays(today, 1);
  while (weekdayOf(d) !== 4) d = addDays(d, 1);
  return [d, addDays(d, 2)] as const;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const d = db();
  const s = settings(d);
  const user = await currentUser();
  const today = todayIn(s.timezone);
  const [defIn, defOut] = nextWeekend(today);
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  let checkIn = valid(sp.in) ?? defIn;
  let checkOut = valid(sp.out) ?? defOut;
  if (checkIn < today) checkIn = defIn;
  if (checkOut <= checkIn) checkOut = addDays(checkIn, 2);
  const guests = Math.max(1, Math.min(20, Number(sp.guests) || 4));
  const region = sp.region ?? "";
  const filters = new Set((sp.f ?? "").split(",").filter(Boolean));
  const regions = all<{ slug: string; name_ar: string }>(d, "SELECT slug, name_ar FROM regions ORDER BY sort");
  const hidden = !s.launched && user?.role !== "admin";

  const cards = hidden
    ? []
    : listingCards(d)
        .filter((c) => !region || c.region_slug === region)
        .filter((c) => c.capacity >= guests)
        .filter((c) => (!filters.has("beach") || c.beachfront) && (!filters.has("pool") || c.pool) && (!filters.has("family") || c.families_only) && (!filters.has("rooms3") || c.rooms >= 3) && (!filters.has("pets") || c.pets_allowed) && (!filters.has("flex") || c.cancellation_policy === "flexible"))
        .filter((c) => isAvailable(d, c.id, checkIn, checkOut))
        .map((c) => ({ c, q: quote(d, c, checkIn, checkOut, s) }));

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(region ? { region } : {}), in: checkIn, out: checkOut, guests: String(guests), ...(filters.size ? { f: [...filters].join(",") } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/?${p}`;
  };
  const toggle = (k: string) => {
    const next = new Set(filters);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return qs({ f: [...next].join(",") });
  };
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);

  return (
    <>
      <SiteHeader brand={s.brand_ar} />
      <main id="main">
        <section className="hero">
          <div className="wrap">
            <h1>
              شاليهات متصوّرة ومتراجعة بنفسنا،
              <br />
              والدفع محمي لحد ما تستلم
            </h1>
            <p>كل وحدة زرناها وصورناها. فلوسك بتوصل للمالك بعد ما تدخل الشاليه، والتقييمات من ناس سكنت فعلًا.</p>
            {hidden ? (
              <p style={{ color: "#fff", fontWeight: 700 }}>بنجهّز أول ٥٠ شاليه بنفسنا، والحجز هيفتح قريب. عندك شاليه؟ سجّله دلوقتي.</p>
            ) : (
              <form className="searchbar" method="get" action="/" role="search">
                <label style={{ flex: "2 1 220px" }}>
                  المنطقة
                  <select name="region" defaultValue={region}>
                    <option value="">كل المناطق · كل القرى</option>
                    {regions.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.name_ar} · كل القرى
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: "1 1 150px" }}>
                  الوصول
                  <input type="date" name="in" defaultValue={checkIn} min={today} required />
                </label>
                <label style={{ flex: "1 1 150px" }}>
                  المغادرة
                  <input type="date" name="out" defaultValue={checkOut} min={addDays(today, 1)} required />
                </label>
                <label style={{ flex: "1 1 120px" }}>
                  الأفراد
                  <select name="guests" defaultValue={guests}>
                    {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => (
                      <option key={n} value={n}>
                        {ar(n)} أفراد
                      </option>
                    ))}
                  </select>
                </label>
                {filters.size ? <input type="hidden" name="f" value={[...filters].join(",")} /> : null}
                <button type="submit">ابحث</button>
              </form>
            )}
          </div>
        </section>

        {!hidden ? (
          <>
            <nav className="wrap chips" style={{ paddingTop: 28 }} aria-label="فلاتر">
              <Link className={`chip${filters.size === 0 ? " on" : ""}`} href={qs({ f: "" })} prefetch={false}>
                الكل
              </Link>
              {CHIPS.map(([k, label]) => (
                <Link key={k} className={`chip${filters.has(k) ? " on" : ""}`} href={toggle(k)} aria-current={filters.has(k) ? "true" : undefined} prefetch={false}>
                  {label}
                </Link>
              ))}
            </nav>

            <section className="wrap" style={{ paddingBlock: 24, display: "flex", flexDirection: "column", gap: 18 }} aria-labelledby="res">
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h2 id="res" style={{ margin: 0, fontSize: 30 }}>
                  متاح في التواريخ دي
                </h2>
                <span className="muted" style={{ fontSize: 14 }}>
                  {fmtRange(checkIn, checkOut)} · {nightsWord(nights)} · الأسعار لليلة وبتتغير حسب الموسم والويك إند
                </span>
              </div>
              {cards.length === 0 ? <div className="card" style={{ padding: 20 }}>مفيش وحدات متاحة بالشروط دي. جرّب تواريخ أو فلاتر تانية.</div> : null}
              <div className="units">
                {cards.map(({ c, q }, i) => (
                  <Link key={c.id} className="unit" href={`/chalets/${c.slug}?in=${checkIn}&out=${checkOut}&guests=${guests}`} prefetch={false}>
                    <div className="ph">
                      {c.photo ? <Image src={c.photo} alt={c.title_ar} fill sizes="(max-width: 600px) 100vw, 300px" priority={i < 2} style={{ objectFit: "cover" }} /> : null}
                      <span className="badge-visited">زرناها وصورناها</span>
                    </div>
                    <div className="row">
                      <span style={{ fontWeight: 800 }}>{c.title_ar}</span>
                      {c.reviews ? (
                        <span className="muted" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
                          ★ {fmtRating(c.rating)} ({ar(c.reviews)})
                        </span>
                      ) : null}
                    </div>
                    <div className="meta">
                      {c.region_slug === "north-coast" ? "الساحل" : c.region_ar} · كم {ar(c.km_marker ?? 0)} · {ar(c.capacity)} أفراد
                    </div>
                    <div style={{ marginTop: -6 }}>
                      <span style={{ fontWeight: 800 }}>{fmtNum(Math.round(q.nightsTotal / q.nights.length / 50) * 50)} ج.م</span> <span className="muted" style={{ fontSize: 14 }}>/ الليلة</span>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {q.meetsMinNights ? `الإجمالي ${fmtNum(q.total)} ج.م لـ ${nightsWord(q.nights.length)}` : `أقل مدة ${nightsWord(q.minNights)} في التواريخ دي`}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </>
        ) : null}

        <section id="trust" className="wrap" style={{ paddingBlock: 48, display: "flex", flexDirection: "column", gap: 20 }} aria-labelledby="trust-h">
          <h2 id="trust-h" style={{ margin: 0, fontSize: 30 }}>
            إزاي بنضمن حجزك
          </h2>
          <div className="trust-grid">
            {TRUST.map(([h, t], i) => (
              <div key={h} className="card trust-card">
                <div className="num">{ar(i + 1)}</div>
                <div style={{ fontWeight: 800 }}>{h}</div>
                <div className="muted" style={{ fontSize: 15 }}>
                  {t}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap" style={{ paddingBottom: 64 }}>
          <div className="owner-cta">
            <div style={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="display" style={{ fontSize: 28, fontWeight: 700 }}>
                عندك شاليه؟ املاه في الموسم الهادي
              </div>
              <div style={{ color: "var(--ink-2)" }}>
                بنصوّر الوحدة مجانًا، ونربط تقويمك مع Airbnb وBooking.com عشان مفيش حجز مزدوج. اختار: عمولة على الحجز ({ar(s.commission_pct)}٪)، أو إدارة كاملة واحنا نستلم الضيوف ({ar(s.managed_pct)}٪).
              </div>
            </div>
            <Link className="pill dark lg" href="/list-your-chalet" prefetch={false}>
              سجّل وحدتك
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter brand={s.brand_ar} phone={s.support_phone} />
    </>
  );
}
