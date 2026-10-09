import { all, get, run, type DB } from "@/lib/db";
import type { PriceRule, LengthOfStayDiscount, DateBlock } from "@/booking-engine";
import type { Booking, Guest, Listing, ListingCard, Owner, Settings } from "./types";

export function settings(db: DB): Settings {
  return get<Settings>(db, "SELECT * FROM platform_settings WHERE id = 1")!;
}

const CARD_SQL = `
  SELECT l.*, c.name_ar AS compound_ar, c.km_marker, r.name_ar AS region_ar, r.slug AS region_slug,
         (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY sort, id LIMIT 1) AS photo,
         (SELECT ROUND(AVG(rating), 1) FROM reviews v WHERE v.listing_id = l.id AND v.author_side = 'guest') AS rating,
         (SELECT COUNT(*) FROM reviews v WHERE v.listing_id = l.id AND v.author_side = 'guest') AS reviews,
         (SELECT amount FROM price_rules pr WHERE pr.listing_id = l.id AND pr.type = 'base' ORDER BY priority DESC, id DESC LIMIT 1) AS from_price
    FROM listings l JOIN compounds c ON c.id = l.compound_id JOIN regions r ON r.id = c.region_id`;

export function listingCards(db: DB, where = "l.status = 'live'", ...params: (string | number)[]): ListingCard[] {
  return all<ListingCard>(db, `${CARD_SQL} WHERE ${where} ORDER BY l.id`, ...params);
}

export function listingCard(db: DB, slugOrId: string | number): ListingCard | undefined {
  return typeof slugOrId === "number"
    ? get<ListingCard>(db, `${CARD_SQL} WHERE l.id = ?`, slugOrId)
    : get<ListingCard>(db, `${CARD_SQL} WHERE l.slug = ?`, slugOrId);
}

export function listing(db: DB, id: number) {
  return get<Listing>(db, "SELECT * FROM listings WHERE id = ?", id);
}

export function photos(db: DB, listingId: number) {
  return all<{ id: number; url: string; caption_ar: string; sort: number; photographed_by_us: number; taken_on: string | null }>(
    db,
    "SELECT * FROM listing_photos WHERE listing_id = ? ORDER BY sort, id",
    listingId,
  );
}

interface PriceRuleRow {
  id: number;
  type: PriceRule["type"];
  label: string;
  start_date: string | null;
  end_date: string | null;
  weekdays: string | null;
  amount: number | null;
  percent: number | null;
  min_nights: number | null;
  priority: number;
}

export function priceRuleRows(db: DB, listingId: number) {
  return all<PriceRuleRow>(db, "SELECT * FROM price_rules WHERE listing_id = ? ORDER BY CASE type WHEN 'base' THEN 0 WHEN 'weekday_uplift' THEN 1 ELSE 2 END, start_date, id", listingId);
}

export function priceRules(db: DB, listingId: number): PriceRule[] {
  return priceRuleRows(db, listingId).map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    weekdays: r.weekdays ? r.weekdays.split(",").map(Number) : null,
    amount: r.amount,
    percent: r.percent,
    minNights: r.min_nights,
    priority: r.priority,
  }));
}

export function losDiscounts(db: DB, listingId: number): LengthOfStayDiscount[] {
  return all<{ min_nights: number; percent: number; label: string }>(db, "SELECT * FROM los_discounts WHERE listing_id = ?", listingId).map((d) => ({
    minNights: d.min_nights,
    percent: d.percent,
    label: d.label,
  }));
}

export interface BlockRow {
  id: number;
  listing_id: number;
  start_date: string;
  end_date: string;
  source: "booking" | "owner_block" | "ical_import";
  booking_id: number | null;
  feed_id: number | null;
  external_uid: string | null;
  summary: string;
  conflict: number;
}

export function activeBlocks(db: DB, listingId: number, from?: string, to?: string): BlockRow[] {
  if (from && to)
    return all<BlockRow>(
      db,
      "SELECT * FROM calendar_blocks WHERE listing_id = ? AND status = 'active' AND start_date < ? AND end_date > ? ORDER BY start_date",
      listingId,
      to,
      from,
    );
  return all<BlockRow>(db, "SELECT * FROM calendar_blocks WHERE listing_id = ? AND status = 'active' ORDER BY start_date", listingId);
}

export const toDateBlocks = (rows: BlockRow[]): DateBlock[] => rows.map((b) => ({ start: b.start_date, end: b.end_date }));

export function bookingByToken(db: DB, token: string) {
  return get<Booking>(db, "SELECT * FROM bookings WHERE public_token = ?", token);
}
export function booking(db: DB, id: number) {
  return get<Booking>(db, "SELECT * FROM bookings WHERE id = ?", id);
}
export function guest(db: DB, id: number) {
  return get<Guest>(db, "SELECT * FROM guests WHERE id = ?", id);
}
export function ownerByUser(db: DB, userId: number) {
  return get<Owner>(db, "SELECT * FROM owners WHERE user_id = ?", userId);
}
export function owner(db: DB, id: number) {
  return get<Owner>(db, "SELECT * FROM owners WHERE id = ?", id);
}

/** Owner-scoped access: every owner query filters by owner_id so owner A can never read owner B. */
export function ownerScope(db: DB, ownerId: number) {
  return {
    listings: () => all<Listing>(db, "SELECT * FROM listings WHERE owner_id = ? ORDER BY id", ownerId),
    listing: (id: number) => get<Listing>(db, "SELECT * FROM listings WHERE owner_id = ? AND id = ?", ownerId, id),
    bookings: (listingId: number) =>
      all<Booking & { guest_name: string | null; payout_status: string | null; payout_amount: number | null }>(
        db,
        `SELECT b.*, g.name AS guest_name, p.status AS payout_status, p.amount AS payout_amount
           FROM bookings b JOIN listings l ON l.id = b.listing_id LEFT JOIN guests g ON g.id = b.guest_id LEFT JOIN payouts p ON p.booking_id = b.id
          WHERE l.owner_id = ? AND b.listing_id = ? AND b.status NOT IN ('hold','pending_payment')
          ORDER BY b.check_in`,
        ownerId,
        listingId,
      ),
    booking: (id: number) =>
      get<Booking>(db, "SELECT b.* FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE l.owner_id = ? AND b.id = ?", ownerId, id),
  };
}

export function audit(db: DB, actor: { userId: number | null; name: string }, action: string, entity: string, entityId: number | null, amount?: number | null, details?: unknown) {
  run(
    db,
    "INSERT INTO audit_log (user_id, actor, action, entity, entity_id, amount, details) VALUES (?,?,?,?,?,?,?)",
    actor.userId,
    actor.name,
    action,
    entity,
    entityId,
    amount ?? null,
    details === undefined ? null : JSON.stringify(details),
  );
}

export const SYSTEM = { userId: null, name: "system" };
