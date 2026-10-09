// Demo seed for "مصيف", matching the approved designs. Idempotent (slugs / emails / seed keys).
// All names, numbers and photos are fictional sample content.
import { get, run, transaction, type DB } from "@/lib/db";
import { blindIndex, encryptField, hashPassword, randomToken } from "@/lib/crypto";
import { addDays } from "@/booking-engine";
import { applyFeedEvents } from "./ical";

export const DEMO_LOGINS = [
  { email: "admin@masyaf.example", password: "Masyaf#Admin2026", role: "admin", name: "فريق مصيف" },
  { email: "inspector@masyaf.example", password: "Masyaf#Inspect2026", role: "inspector", name: "كريم الشامي" },
  { email: "sherif@masyaf.example", password: "Masyaf#Owner2026", role: "owner", name: "م. شريف عبد العزيز" },
  { email: "dalia@masyaf.example", password: "Masyaf#Owner2026", role: "owner", name: "داليا منصور" },
] as const;

const REVIEW_TEXTS = [
  "الشاليه زي الصور بالظبط، والاستلام كان سهل ومنظم.",
  "مكان هادي ونضيف، والبحر قدامنا على طول. هنرجع تاني.",
  "أول مرة أحجز ومتطمن إن فلوسي محفوظة لحد ما دخلت.",
  "المالك محترم جدًا، والتأمين رجع في نفس اليوم.",
  "مناسب للعائلات، والمطبخ مجهز بكل حاجة.",
  "الصور حقيقية مش متعدلة، وده نادر في الساحل.",
  "كل حاجة كانت تمام، بس التكييف في أوضة الأطفال كان ضعيف شوية.",
];
const NAMES = ["هبة السيد", "محمود عادل", "رانيا فتحي", "عمر خليل", "ياسمين حسن", "طارق نبيل", "سلمى إبراهيم", "خالد مراد", "منة الله أحمد", "يوسف كمال", "نادين وليد", "حسام زكي"];

export function seedDemo(db: DB, now: Date = new Date()) {
  return transaction(db, () => inner(db, now));
}

export function resetDemo(db: DB) {
  db.exec("PRAGMA foreign_keys = OFF"); // wipe order across many tables; re-enabled below
  transaction(db, () => {
    for (const t of ["reviews", "issues", "refunds", "payouts", "deposit_holds", "payments", "calendar_blocks", "bookings", "ical_feeds", "los_discounts", "price_rules", "inspections", "listing_photos", "listings", "owners", "users", "guests", "compounds", "regions", "message_log", "audit_log", "webhook_events", "demo_feed_events", "photo_blobs", "platform_settings"])
      run(db, `DELETE FROM ${t}`);
  });
  db.exec("PRAGMA foreign_keys = ON");
}

function inner(db: DB, now: Date) {
  const today = now.toISOString().slice(0, 10);
  if (!get(db, "SELECT 1 FROM platform_settings")) {
    run(
      db,
      `INSERT INTO platform_settings (id, brand_ar, brand_en, support_phone, service_fee_pct, commission_pct, managed_pct, payout_release_hours, deposit_return_days, ical_sync_minutes, launched, demo)
       VALUES (1, 'مصيف', 'Masyaf', '01223344556', 5, 12, 25, 6, 3, 15, 1, 1)`,
    );
  }

  const region = (slug: string, ar: string, en: string, sort: number) =>
    get<{ id: number }>(db, "SELECT id FROM regions WHERE slug = ?", slug)?.id ?? run(db, "INSERT INTO regions (slug, name_ar, name_en, sort) VALUES (?,?,?,?)", slug, ar, en, sort).id;
  const nc = region("north-coast", "الساحل الشمالي", "North Coast", 0);
  const sk = region("ain-sokhna", "العين السخنة", "Ain Sokhna", 1);
  const compound = (slug: string, r: number, ar: string, en: string, km: number, lat: number, lng: number) =>
    get<{ id: number }>(db, "SELECT id FROM compounds WHERE slug = ?", slug)?.id ??
    run(db, "INSERT INTO compounds (region_id, slug, name_ar, name_en, km_marker, lat, lng) VALUES (?,?,?,?,?,?,?)", r, slug, ar, en, km, lat, lng).id;
  const noras = compound("al-nawras", nc, "النورس", "Al Nawras", 125, 30.952, 28.94);
  const lulua = compound("al-loaloa", nc, "اللؤلؤة", "Al Loaloa", 105, 30.86, 29.13);
  const morgan = compound("al-morgan", nc, "المرجان", "Al Morgan", 140, 30.99, 28.8);
  const fayrouz = compound("al-fayrouz", sk, "الفيروز", "Al Fayrouz", 65, 29.63, 32.35);

  const users: Record<string, number> = {};
  for (const u of DEMO_LOGINS)
    users[u.email] =
      get<{ id: number }>(db, "SELECT id FROM users WHERE email = ?", u.email)?.id ??
      run(db, "INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)", u.name, u.email, hashPassword(u.password), u.role).id;
  const ownerRow = (email: string, name: string, plan: string, payout: string) =>
    get<{ id: number }>(db, "SELECT id FROM owners WHERE user_id = ?", users[email]!)?.id ??
    run(
      db,
      "INSERT INTO owners (user_id, display_name, phone_enc, identity_status, identity_ref, payout_method, payout_masked, plan, agreement_signed_at) VALUES (?,?,?, 'verified', ?, 'bank', ?, ?, ?)",
      users[email]!,
      name,
      encryptField("+201001112223"),
      `kyc_sim_${email.split("@")[0]}`,
      payout,
      plan,
      addDays(today, -200),
    ).id;
  const sherif = ownerRow("sherif@masyaf.example", "م. شريف عبد العزيز", "commission", "CIB •••• 4471");
  const dalia = ownerRow("dalia@masyaf.example", "داليا منصور", "managed", "InstaPay •••• 0912");

  const L = (o: {
    slug: string; owner: number; compound: number; title: string; titleEn: string; cap: number; rooms: number; baths: number; parking: number;
    beach: number; pool: number; families: number; pets: number; note: string; policy: string; deposit: number; photos: string[];
    lat: number; lng: number; rules: [string, string | null, string | null, string | null, number | null, number | null, number | null, number, string][]; los?: [number, number, string][];
  }) => {
    const ex = get<{ id: number }>(db, "SELECT id FROM listings WHERE slug = ?", o.slug);
    if (ex) return ex.id;
    const id = run(
      db,
      `INSERT INTO listings (owner_id, compound_id, slug, title_ar, title_en, category, capacity, rooms, baths, parking, beachfront, pool, families_only, pets_allowed,
         location_note_ar, description_ar, house_rules_ar, amenities, address_private, handover_name, handover_phone_enc, lat, lng, status, cancellation_policy, security_deposit, ical_export_token)
       VALUES (?,?,?,?,?, 'chalet', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'live', ?,?,?)`,
      o.owner, o.compound, o.slug, o.title, o.titleEn, o.cap, o.rooms, o.baths, o.parking, o.beach, o.pool, o.families, o.pets,
      o.note,
      "وحدة مفروشة بالكامل، تكييفات في كل الأوض، مطبخ مجهز، وإنترنت. فريقنا زارها وصورها بنفسه، والصور بتاريخ الزيارة.",
      "ممنوع الحفلات والصوت العالي بعد ١٢ بالليل · ممنوع التدخين جوه · الدخول من ٣ العصر والخروج ١٢ الظهر",
      JSON.stringify(["تكييف", "واي فاي", "مطبخ مجهز", "غسالة", "شاشة", "باركينج"]),
      `${o.titleEn} — building 7, unit 12`,
      "عم سيد (أمن القرية)",
      encryptField("+201005556667"),
      o.lat, o.lng, o.policy, o.deposit, randomToken(12),
    ).id;
    o.photos.forEach((p, i) => run(db, "INSERT INTO listing_photos (listing_id, url, sort, photographed_by_us, taken_on) VALUES (?,?,?,1,?)", id, `/img/${p}`, i, addDays(today, -60)));
    run(db, "INSERT INTO inspections (listing_id, inspector_user_id, checklist, notes, passed, inspected_at) VALUES (?,?,?,?,1,?)", id, users["inspector@masyaf.example"]!,
      JSON.stringify({ photos_match: true, ac_working: true, water_heater: true, kitchen: true, safety: true, keys_handover: true, cleanliness: true }), "زيارة كاملة، كل البنود تمام.", new Date(Date.parse(today) - 60 * 86_400_000).toISOString());
    for (const [type, label, from, to, amount, percent, minN, prio, wd] of o.rules)
      run(db, "INSERT INTO price_rules (listing_id, type, label, start_date, end_date, amount, percent, min_nights, priority, weekdays) VALUES (?,?,?,?,?,?,?,?,?,?)", id, type, label ?? "", from, to, amount, percent, minN, prio, wd || null);
    for (const [n, pct, label] of o.los ?? []) run(db, "INSERT INTO los_discounts (listing_id, min_nights, percent, label) VALUES (?,?,?,?)", id, n, pct, label);
    return id;
  };

  const norasId = L({
    slug: "nawras-3br-frontline", owner: sherif, compound: noras, title: "شاليه ٣ غرف صف أول · النورس", titleEn: "3-bedroom front-row chalet · Al Nawras",
    cap: 8, rooms: 3, baths: 2, parking: 2, beach: 1, pool: 0, families: 1, pets: 0, note: "صف أول على البحر", policy: "moderate", deposit: 3000,
    photos: ["chalet-beach.jpg", "terrace-crop.jpg", "beach-crop.jpg"], lat: 30.9521, lng: 28.9412,
    rules: [
      ["base", "سعر الليلة العادي", null, null, 3800, null, 2, 0, ""],
      ["weekday_uplift", "الخميس والجمعة", null, null, null, 18, null, 0, "4,5"],
      ["season", "موسم الصيف والأعياد", "2027-08-10", "2027-08-12", 5500, null, 3, 10, ""],
      ["season", "موسم الصيف والأعياد", "2027-08-24", "2027-08-29", 5500, null, 3, 10, ""],
      ["season", "رأس السنة", "2026-12-30", "2027-01-02", 5500, null, 3, 10, ""],
    ],
    los: [[7, 10, "خصم الإقامة الأسبوعية"]],
  });
  const luluaId = L({
    slug: "loaloa-townhouse-pool", owner: dalia, compound: lulua, title: "تاون هاوس بحمام سباحة · اللؤلؤة", titleEn: "Townhouse with pool · Al Loaloa",
    cap: 10, rooms: 4, baths: 3, parking: 2, beach: 0, pool: 1, families: 1, pets: 0, note: "حمام سباحة خاص · ٥ دقايق مشي للبحر", policy: "moderate", deposit: 5000,
    photos: ["townhouse.jpg", "terrace-crop.jpg"], lat: 30.861, lng: 29.131,
    rules: [["base", "سعر الليلة", null, null, 7200, null, 2, 0, ""]],
    los: [[7, 10, "خصم الإقامة الأسبوعية"]],
  });
  const fayrouzId = L({
    slug: "fayrouz-2br-sea", owner: sherif, compound: fayrouz, title: "شاليه غرفتين على البحر · الفيروز", titleEn: "2-bedroom sea-view chalet · Al Fayrouz",
    cap: 5, rooms: 2, baths: 1, parking: 1, beach: 1, pool: 0, families: 0, pets: 1, note: "على البحر مباشرة · العين السخنة", policy: "flexible", deposit: 1500,
    photos: ["beach-crop.jpg", "terrace-crop.jpg"], lat: 29.631, lng: 32.351,
    rules: [["base", "سعر الليلة", null, null, 2800, null, 1, 0, ""]],
  });
  const morganId = L({
    slug: "morgan-lagoon-ground", owner: dalia, compound: morgan, title: "شاليه أرضي على اللاجون · المرجان", titleEn: "Ground-floor lagoon chalet · Al Morgan",
    cap: 6, rooms: 3, baths: 2, parking: 1, beach: 0, pool: 1, families: 1, pets: 0, note: "أرضي بجنينة على اللاجون", policy: "flexible", deposit: 2000,
    photos: ["lagoon-crop.jpg", "terrace-crop.jpg"], lat: 30.991, lng: 28.801,
    rules: [["base", "سعر الليلة", null, null, 3600, null, 2, 0, ""]],
  });

  // ---- guests, bookings, payouts (owner dashboard design) ----
  const guestRow = (name: string, phone: string) => {
    const e164 = `+20${phone.slice(1)}`;
    const hash = blindIndex(e164);
    return (
      get<{ id: number }>(db, "SELECT id FROM guests WHERE phone_hash = ?", hash)?.id ??
      run(db, "INSERT INTO guests (name, phone_enc, phone_hash, phone_last4, id_status, id_type, id_ref, id_last4, id_verified_at) VALUES (?,?,?,?, 'verified', 'national_id', ?, ?, ?)",
        name, encryptField(e164), hash, e164.slice(-4), `idv_sim_${randomToken(6)}`, phone.slice(-4), now.toISOString()).id
    );
  };
  const book = (o: { key: string; listing: number; guest: number; inDate: string; outDate: string; nightly: number[]; tier?: string; status: string; payout: string; commission: number; plan: string; guests: number; deposit: number; policy: string; deposit_status?: string }) => {
    const ex = get<{ id: number }>(db, "SELECT id FROM bookings WHERE seed_key = ?", o.key);
    if (ex) return ex.id;
    const dates: string[] = [];
    for (let d = o.inDate; d < o.outDate; d = addDays(d, 1)) dates.push(d);
    const nightsTotal = o.nightly.reduce((s, n) => s + n, 0);
    const fee = Math.round(nightsTotal * 0.05);
    const token = randomToken();
    const ownerAmount = Math.round(nightsTotal * (1 - o.commission / 100));
    const id = run(
      db,
      `INSERT INTO bookings (ref, public_token, listing_id, guest_id, check_in, check_out, guests_count, nightly_json, subtotal, discount, nights_total, service_fee, total, security_deposit,
         policy, plan, commission_pct, owner_payout, status, pay_method, checked_in_at, checked_out_at, seed_key, created_at, arrival_sent_at, checkin_prompt_sent_at, checkout_reminder_sent_at, review_request_sent_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?, 'card', ?,?,?,?,?,?,?,?)`,
      `tmp_${token}`, token, o.listing, o.guest, o.inDate, o.outDate, o.guests,
      JSON.stringify(dates.map((d, i) => ({ date: d, amount: o.nightly[i], tier: o.tier ?? "regular" }))),
      nightsTotal, nightsTotal, fee, nightsTotal + fee, o.deposit, o.policy, o.plan, o.commission, ownerAmount, o.status,
      o.status === "completed" ? `${o.inDate}T13:00:00.000Z` : null,
      o.status === "completed" ? `${o.outDate}T09:00:00.000Z` : null,
      o.key,
      new Date(Date.parse(o.inDate) - 30 * 86_400_000).toISOString(),
      ...(o.status === "completed" ? [o.inDate, o.inDate, o.outDate, o.outDate] : [null, null, null, null]),
    ).id;
    run(db, "UPDATE bookings SET ref = ? WHERE id = ?", `MS-${30000 + id}`, id);
    run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, booking_id, summary) VALUES (?,?,?, 'booking', ?, 'booking')", o.listing, o.inDate, o.outDate, id);
    run(db, "INSERT INTO payments (booking_id, kind, method, amount_cents, status, provider_ref, provider_order_id) VALUES (?, 'charge', 'card', ?, 'paid', ?, ?)", id, (nightsTotal + fee) * 100, `seed_txn_${id}`, `seed_${id}`);
    const listingOwner = get<{ owner_id: number }>(db, "SELECT owner_id FROM listings WHERE id = ?", o.listing)!.owner_id;
    run(db, "INSERT INTO payouts (booking_id, owner_id, amount, status, paid_at, batch_ref) VALUES (?,?,?,?,?,?)", id, listingOwner, ownerAmount, o.payout, o.payout === "paid" ? `${o.outDate}T10:00:00.000Z` : null, o.payout === "paid" ? "B-SEED" : null);
    if (o.deposit) run(db, "INSERT INTO deposit_holds (booking_id, amount, mode, status, released_at) VALUES (?,?, 'authorization', ?, ?)", id, o.deposit, o.status === "completed" ? "released" : "held", o.status === "completed" ? `${addDays(o.outDate, 1)}T10:00:00.000Z` : null);
    return id;
  };
  const common = { commission: 12, plan: "commission", deposit: 3000, policy: "moderate" };
  book({ ...common, key: "hamdy", listing: norasId, guest: guestRow("عائلة حمدي", "01011122233"), inDate: "2027-08-03", outDate: "2027-08-06", nightly: [4500, 4500, 4500], tier: "weekend", status: "confirmed", payout: "held", guests: 7 });
  book({ ...common, key: "fawzy", listing: norasId, guest: guestRow("أحمد فوزي", "01122233344"), inDate: "2027-08-14", outDate: "2027-08-15", nightly: [4500], tier: "weekend", status: "confirmed", payout: "held", guests: 4 });
  const nourhan = book({ ...common, key: "nourhan", listing: norasId, guest: guestRow("نورهان سعيد", "01233344455"), inDate: "2026-07-20", outDate: "2026-07-25", nightly: [3800, 3800, 3800, 3800, 3800], status: "completed", payout: "paid", guests: 6 });

  // Owner block (21–22 Aug) and the Airbnb feed with Laura M. (9–11 Aug)
  if (!get(db, "SELECT 1 FROM calendar_blocks WHERE listing_id = ? AND source = 'owner_block'", norasId))
    run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, summary) VALUES (?, '2027-08-21', '2027-08-23', 'owner_block', 'مقفول من المالك')", norasId);
  if (!get(db, "SELECT 1 FROM demo_feed_events WHERE uid = 'airbnb-HM4KX2-laura'"))
    run(db, "INSERT INTO demo_feed_events (feed_key, uid, start_date, end_date, summary) VALUES ('airbnb-nawras', 'airbnb-HM4KX2-laura', '2027-08-09', '2027-08-11', 'Reserved · Laura M.')");
  let feed = get<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE listing_id = ? AND provider = 'Airbnb'", norasId)?.id;
  if (!feed) {
    feed = run(db, "INSERT INTO ical_feeds (listing_id, provider, url) VALUES (?, 'Airbnb', ?)", norasId, "/api/demo-feeds/airbnb-nawras.ics").id;
    applyFeedEvents(db, feed, [{ uid: "airbnb-HM4KX2-laura", start: "2027-08-09", end: "2027-08-11", summary: "Reserved · Laura M." }], new Date(now.getTime() - 4 * 60_000));
  }

  // Verified reviews from completed stays, so ratings are real aggregates.
  const plan: [number, number, number, number, number][] = [
    // listing, count of 5★, count of 4★, base price, owner commission
    [norasId, 21, 2, 3800, 12],
    [luluaId, 14, 3, 7200, 25],
    [fayrouzId, 22, 9, 2800, 12],
    [morganId, 9, 0, 3600, 25],
  ];
  let n = 0;
  for (const [listingId, fives, fours, price, commission] of plan) {
    const ratings = [...Array(fives).fill(5), ...Array(fours).fill(4)];
    let start = "2025-06-01";
    ratings.forEach((rating, i) => {
      // reuse Nourhan's real stay for one of the Nawras reviews
      if (listingId === norasId && i === 0) {
        if (!get(db, "SELECT 1 FROM reviews WHERE booking_id = ?", nourhan))
          run(db, "INSERT INTO reviews (booking_id, listing_id, author_side, author_name, rating, text, reply, reply_at, created_at) VALUES (?,?, 'guest', 'نورهان سعيد', 5, ?, ?, ?, ?)",
            nourhan, norasId, "الشاليه زي الصور بالظبط والبحر قدامنا. م. شريف كان متعاون جدًا في الاستلام.", "نورتونا، ومستنيينكم الصيف الجاي!", "2026-07-27T12:00:00.000Z", "2026-07-26T12:00:00.000Z");
        return;
      }
      if (start >= "2025-09-20" && start < "2026-05-01") start = "2026-05-01";
      if (start >= "2026-07-15" && start < "2026-08-01" && listingId === norasId) start = "2026-08-01";
      const end = addDays(start, 2);
      const name = NAMES[n % NAMES.length]!;
      const gid = guestRow(name, `010${String(70000000 + n).padStart(8, "0")}`);
      const bid = book({ key: `hist-${listingId}-${i}`, listing: listingId, guest: gid, inDate: start, outDate: end, nightly: [price, price], status: "completed", payout: "paid", guests: 4, deposit: 0, policy: "moderate", commission, plan: commission === 25 ? "managed" : "commission" });
      if (!get(db, "SELECT 1 FROM reviews WHERE booking_id = ?", bid))
        run(db, "INSERT INTO reviews (booking_id, listing_id, author_side, author_name, rating, text, created_at) VALUES (?,?, 'guest', ?,?,?,?)", bid, listingId, name, rating, REVIEW_TEXTS[n % REVIEW_TEXTS.length]!, `${addDays(end, 1)}T12:00:00.000Z`);
      n++;
      start = addDays(start, 5);
    });
  }
  return { listings: [norasId, luluaId, fayrouzId, morganId] };
}
