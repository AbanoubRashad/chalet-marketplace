import { all, get, run, transaction, type DB } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { MarketError, confirmPaidBooking, createHold, upsertGuest } from "./booking";
import { audit, booking } from "./repo";
import { normalizeEgyptianMobile } from "@/lib/phone";

type Actor = { userId: number | null; name: string };

export const CHECKLIST: [string, string][] = [
  ["photos_match", "الصور مطابقة للوحدة"],
  ["ac_working", "التكييفات شغالة"],
  ["water_heater", "السخان والمياه"],
  ["kitchen", "المطبخ مجهز"],
  ["safety", "طفاية حريق ومخرج آمن"],
  ["keys_handover", "ترتيب تسليم المفاتيح واضح"],
  ["cleanliness", "النظافة"],
];

export function createDraftListing(
  db: DB,
  actor: Actor,
  input: { ownerId: number; compoundId: number; title: string; capacity: number; rooms: number; baths: number; parking: number; beachfront: boolean; pool: boolean; note: string; base: number; deposit: number },
) {
  if (input.title.trim().length < 5 || input.capacity < 1 || input.base <= 0) throw new MarketError("INVALID_STATE", "كمّل بيانات الوحدة");
  return transaction(db, () => {
    const slug = `unit-${randomToken(5).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    const id = run(
      db,
      `INSERT INTO listings (owner_id, compound_id, slug, title_ar, capacity, rooms, baths, parking, beachfront, pool, location_note_ar, security_deposit, ical_export_token, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
      input.ownerId,
      input.compoundId,
      slug,
      input.title.trim(),
      input.capacity,
      input.rooms,
      input.baths,
      input.parking,
      input.beachfront ? 1 : 0,
      input.pool ? 1 : 0,
      input.note.trim(),
      input.deposit,
      randomToken(12),
    ).id;
    run(db, "INSERT INTO price_rules (listing_id, type, label, amount, min_nights) VALUES (?, 'base', 'سعر الليلة العادي', ?, 2)", id, input.base);
    audit(db, actor, "listing.draft_created", "listing", id);
    return id;
  });
}

export function addPhoto(db: DB, actor: Actor, listingId: number, file: { mime: string; bytes: Uint8Array }) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.mime)) throw new MarketError("INVALID_STATE", "الصور لازم تكون JPG أو PNG أو WEBP");
  if (file.bytes.byteLength > 6 * 1024 * 1024) throw new MarketError("INVALID_STATE", "الصورة أكبر من ٦ ميجا");
  return transaction(db, () => {
    const blob = run(db, "INSERT INTO photo_blobs (mime, data) VALUES (?, ?)", file.mime, file.bytes).id;
    const next = (get<{ n: number }>(db, "SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM listing_photos WHERE listing_id = ?", listingId)?.n ?? 0);
    run(db, "INSERT INTO listing_photos (listing_id, url, sort, photographed_by_us, taken_on) VALUES (?,?,?,1,?)", listingId, `/api/photos/${blob}`, next, new Date().toISOString().slice(0, 10));
    audit(db, actor, "listing.photo_added", "listing", listingId);
  });
}

export function movePhoto(db: DB, listingId: number, photoId: number, dir: -1 | 1) {
  const list = all<{ id: number }>(db, "SELECT id FROM listing_photos WHERE listing_id = ? ORDER BY sort, id", listingId);
  const i = list.findIndex((p) => p.id === photoId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  transaction(db, () => list.forEach((p, k) => run(db, "UPDATE listing_photos SET sort = ? WHERE id = ?", k, p.id)));
}

export function deletePhoto(db: DB, listingId: number, photoId: number) {
  run(db, "DELETE FROM listing_photos WHERE listing_id = ? AND id = ?", listingId, photoId);
}

/** Inspector submits the on-site checklist. All items must pass and at least 3 photos exist to mark "inspected". */
export function submitInspection(db: DB, actor: Actor, listingId: number, checks: Record<string, boolean>, notes: string) {
  const passed = CHECKLIST.every(([k]) => checks[k]);
  const photos = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?", listingId)!.n;
  if (passed && photos < 3) throw new MarketError("INVALID_STATE", "لازم ٣ صور على الأقل قبل اعتماد المعاينة");
  transaction(db, () => {
    run(db, "INSERT INTO inspections (listing_id, inspector_user_id, checklist, notes, passed) VALUES (?,?,?,?,?)", listingId, actor.userId!, JSON.stringify(checks), notes.trim(), passed ? 1 : 0);
    if (passed) run(db, "UPDATE listings SET status = 'inspected' WHERE id = ? AND status = 'draft'", listingId);
    audit(db, actor, passed ? "listing.inspected" : "listing.inspection_failed", "listing", listingId);
  });
  return passed;
}

export function setListingStatus(db: DB, actor: Actor, listingId: number, status: "live" | "paused" | "inspected") {
  const l = get<{ status: string }>(db, "SELECT status FROM listings WHERE id = ?", listingId);
  if (!l) throw new MarketError("NOT_FOUND");
  if (status === "live" && l.status === "draft") throw new MarketError("INVALID_STATE", "لازم الوحدة تتعاين الأول");
  run(db, "UPDATE listings SET status = ? WHERE id = ?", status, listingId);
  audit(db, actor, `listing.${status}`, "listing", listingId);
}

/** Managed plan: our team books a guest who paid offline (phone / bank transfer). */
export function manualBooking(db: DB, actor: Actor, input: { listingId: number; checkIn: string; checkOut: string; guests: number; name: string; phone: string }) {
  const phone = normalizeEgyptianMobile(input.phone);
  if (!phone) throw new MarketError("INVALID_PHONE");
  const hold = createHold(db, { listingId: input.listingId, checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests });
  const g = upsertGuest(db, input.name, phone);
  transaction(db, () => {
    run(db, "UPDATE bookings SET guest_id = ?, pay_method = 'offline' WHERE id = ?", g.id, hold.id);
    run(db, "INSERT INTO payments (booking_id, kind, method, amount_cents, status, provider_ref) VALUES (?, 'charge', 'offline', ?, 'paid', ?)", hold.id, hold.total * 100, `manual_${hold.id}`);
    confirmPaidBooking(db, { ...booking(db, hold.id)!, pay_method: "offline" }, `manual_${hold.id}`, new Date());
    audit(db, actor, "booking.manual", "booking", hold.id, hold.total);
  });
  return booking(db, hold.id)!;
}
