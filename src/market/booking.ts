import { get, run, transaction, type DB } from "@/lib/db";
import { blindIndex, encryptField, randomToken } from "@/lib/crypto";
import { normalizeEgyptianMobile } from "@/lib/phone";
import { addDays, isRangeFree, quoteStay, todayIn, zonedToUtc, type StayQuote } from "@/booking-engine";
import { createIntention, refundTransaction } from "@/payments/paymob";
import { activeBlocks, audit, booking, listing, losDiscounts, priceRules, settings, SYSTEM, toDateBlocks } from "./repo";
import { notify } from "./messages";
import type { Booking, Guest, Listing, Policy, Settings } from "./types";

export class MarketError extends Error {
  constructor(
    public code:
      | "DATES_TAKEN"
      | "MIN_NIGHTS"
      | "TOO_MANY_GUESTS"
      | "NOT_BOOKABLE"
      | "HOLD_EXPIRED"
      | "NOT_FOUND"
      | "INVALID_PHONE"
      | "INVALID_NAME"
      | "ID_REQUIRED"
      | "ID_FAILED"
      | "INVALID_DATES"
      | "INVALID_STATE"
      | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
  }
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface Quote extends StayQuote {
  serviceFee: number;
  total: number;
  deposit: number;
  feePct: number;
}

export function quote(db: DB, l: Listing, checkIn: string, checkOut: string, s: Settings = settings(db)): Quote {
  if (!isDate(checkIn) || !isDate(checkOut) || checkOut <= checkIn) throw new MarketError("INVALID_DATES");
  const q = quoteStay(checkIn, checkOut, priceRules(db, l.id), losDiscounts(db, l.id));
  const serviceFee = Math.round((q.nightsTotal * s.service_fee_pct) / 100);
  return { ...q, serviceFee, total: q.nightsTotal + serviceFee, deposit: l.security_deposit, feePct: s.service_fee_pct };
}

export function isAvailable(db: DB, listingId: number, checkIn: string, checkOut: string) {
  return isRangeFree(checkIn, checkOut, toDateBlocks(activeBlocks(db, listingId, checkIn, checkOut)));
}

/** Releases lapsed holds (optionally for one listing). Runs inside the caller's write transaction when there is one. */
export function sweepHolds(db: DB, now: Date, listingId?: number) {
  const iso = now.toISOString();
  const expired = db
    .prepare(
      `SELECT id FROM bookings WHERE status IN ('hold','pending_payment') AND hold_expires_at IS NOT NULL AND hold_expires_at <= ? ${listingId ? "AND listing_id = ?" : ""}`,
    )
    .all(...(listingId ? [iso, listingId] : [iso])) as { id: number }[];
  for (const { id } of expired) {
    run(db, "UPDATE bookings SET status = 'cancelled', cancel_reason = 'hold_expired', cancelled_by = 'system', cancelled_at = ? WHERE id = ?", iso, id);
    run(db, "UPDATE calendar_blocks SET status = 'released' WHERE booking_id = ? AND source = 'booking'", id);
  }
  return expired.length;
}

/**
 * Reserve [checkIn, checkOut) for `hold_minutes`. Inside one write transaction: sweep lapsed holds,
 * re-check, insert the booking snapshot and its calendar block. The calendar_blocks trigger is the
 * final guarantee against double booking.
 */
export function createHold(db: DB, input: { listingId: number; checkIn: string; checkOut: string; guests: number }, now: Date = new Date()): Booking {
  const s = settings(db);
  const l = listing(db, input.listingId);
  if (!l || l.status !== "live") throw new MarketError("NOT_BOOKABLE");
  if (input.guests < 1 || input.guests > l.capacity) throw new MarketError("TOO_MANY_GUESTS");
  if (input.checkIn < todayIn(s.timezone, now)) throw new MarketError("INVALID_DATES");
  const q = quote(db, l, input.checkIn, input.checkOut, s);
  if (!q.meetsMinNights) throw new MarketError("MIN_NIGHTS", `MIN_NIGHTS ${q.minNights}`);
  const owner = get<{ plan: "commission" | "managed" }>(db, "SELECT plan FROM owners WHERE id = ?", l.owner_id)!;
  const commission = owner.plan === "managed" ? s.managed_pct : s.commission_pct;
  try {
    return transaction(db, () => {
      sweepHolds(db, now, l.id);
      const token = randomToken();
      const { id } = run(
        db,
        `INSERT INTO bookings (ref, public_token, listing_id, check_in, check_out, guests_count, nightly_json, subtotal, discount, nights_total, service_fee, total,
                               security_deposit, policy, plan, commission_pct, owner_payout, status, hold_expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'hold', ?)`,
        `tmp_${token}`,
        token,
        l.id,
        input.checkIn,
        input.checkOut,
        input.guests,
        JSON.stringify(q.nights.map((n) => ({ date: n.date, amount: n.amount, tier: n.tier }))),
        q.subtotal,
        q.discount,
        q.nightsTotal,
        q.serviceFee,
        q.total,
        l.security_deposit,
        l.cancellation_policy,
        owner.plan,
        commission,
        Math.round(q.nightsTotal * (1 - commission / 100)),
        new Date(now.getTime() + s.hold_minutes * 60_000).toISOString(),
      );
      run(db, "UPDATE bookings SET ref = ? WHERE id = ?", `MS-${String(30000 + id)}`, id);
      run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, booking_id, summary) VALUES (?,?,?, 'booking', ?, 'hold')", l.id, input.checkIn, input.checkOut, id);
      return booking(db, id)!;
    });
  } catch (err) {
    if (err instanceof Error && /DATES_TAKEN/.test(err.message)) throw new MarketError("DATES_TAKEN");
    throw err;
  }
}

// ---------------- guest identity ----------------

/** Egyptian national ID: 14 digits, century digit 2/3, valid birth date, governorate code. */
export function validNationalId(id: string): boolean {
  if (!/^[23]\d{13}$/.test(id)) return false;
  const century = id[0] === "2" ? 1900 : 2000;
  const y = century + Number(id.slice(1, 3));
  const m = Number(id.slice(3, 5));
  const d = Number(id.slice(5, 7));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  const gov = Number(id.slice(7, 9));
  return (gov >= 1 && gov <= 35) || gov === 88;
}

/**
 * Identity check before a guest's first booking. Stores only the result, a reference and the last
 * 4 characters, never the number or a document image (see COMPLIANCE.md). The provider call is
 * simulated until a KYC vendor is chosen.
 */
export function verifyGuestId(db: DB, guestId: number, type: "national_id" | "passport", number: string, now = new Date()) {
  const clean = number.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\s/g, "").toUpperCase();
  const ok = type === "national_id" ? validNationalId(clean) : /^[A-Z0-9]{6,9}$/.test(clean);
  run(
    db,
    "UPDATE guests SET id_status = ?, id_type = ?, id_ref = ?, id_last4 = ?, id_verified_at = ? WHERE id = ?",
    ok ? "verified" : "failed",
    type,
    ok ? `idv_sim_${randomToken(8)}` : null,
    clean.slice(-4),
    ok ? now.toISOString() : null,
    guestId,
  );
  return ok;
}

export function upsertGuest(db: DB, name: string, phoneE164: string, email?: string | null): Guest {
  const hash = blindIndex(phoneE164);
  const existing = get<Guest>(db, "SELECT * FROM guests WHERE phone_hash = ?", hash);
  if (existing) {
    run(db, "UPDATE guests SET name = ?, email = COALESCE(?, email) WHERE id = ?", name, email ?? null, existing.id);
    return get<Guest>(db, "SELECT * FROM guests WHERE id = ?", existing.id)!;
  }
  const { id } = run(db, "INSERT INTO guests (name, phone_enc, phone_hash, phone_last4, email) VALUES (?,?,?,?,?)", name, encryptField(phoneE164), hash, phoneE164.slice(-4), email ?? null);
  return get<Guest>(db, "SELECT * FROM guests WHERE id = ?", id)!;
}

export interface CompleteInput {
  name: string;
  phone: string;
  email?: string;
  idType?: "national_id" | "passport";
  idNumber?: string;
  method: "card" | "wallet";
}

/**
 * Guest details + ID + payment. Moves the hold to pending_payment and returns the Paymob checkout URL.
 * The booking is confirmed ONLY by the verified Paymob webhook. Wallet payments include the refundable
 * deposit in the charge (refunded later); card payments place the deposit as a separate authorisation.
 */
export async function completeBooking(db: DB, token: string, input: CompleteInput, urls: { origin: string }, now: Date = new Date()) {
  const s = settings(db);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 3) throw new MarketError("INVALID_NAME");
  const phone = normalizeEgyptianMobile(input.phone);
  if (!phone) throw new MarketError("INVALID_PHONE");
  const b = get<Booking>(db, "SELECT * FROM bookings WHERE public_token = ?", token);
  if (!b) throw new MarketError("NOT_FOUND");
  if (b.status !== "hold" || (b.hold_expires_at && b.hold_expires_at <= now.toISOString())) throw new MarketError("HOLD_EXPIRED");

  const g = upsertGuest(db, name, phone, input.email?.trim() || null);
  if (s.require_guest_id && g.id_status !== "verified") {
    if (!input.idType || !input.idNumber) throw new MarketError("ID_REQUIRED");
    if (!verifyGuestId(db, g.id, input.idType, input.idNumber, now)) throw new MarketError("ID_FAILED");
  }
  const chargeEgp = b.total + (input.method === "wallet" ? b.security_deposit : 0);
  const paymentId = transaction(db, () => {
    run(
      db,
      "UPDATE bookings SET guest_id = ?, status = 'pending_payment', pay_method = ?, hold_expires_at = ? WHERE id = ?",
      g.id,
      input.method,
      new Date(now.getTime() + 15 * 60_000).toISOString(),
      b.id,
    );
    return run(db, "INSERT INTO payments (booking_id, kind, method, amount_cents, status) VALUES (?, 'charge', ?, ?, 'initiated')", b.id, input.method, chargeEgp * 100).id;
  });
  const merchantRef = `pay_${paymentId}`;
  const intention = await createIntention(
    {
      amountCents: chargeEgp * 100,
      method: input.method,
      merchantReference: merchantRef,
      itemName: `Stay ${b.ref}`,
      customer: { firstName: name.split(" ")[0]!, lastName: name.split(" ").slice(1).join(" "), phone, email: input.email || "na@example.com" },
      notificationUrl: `${urls.origin}/api/payments/paymob/webhook`,
      redirectionUrl: `${urls.origin}/trips/${b.public_token}`,
    },
    `${urls.origin}/pay/sandbox?p=${paymentId}&t=${b.public_token}`,
  );
  run(db, "UPDATE payments SET provider_order_id = ? WHERE id = ?", merchantRef, paymentId);
  return { url: intention.checkoutUrl, token: b.public_token };
}

/** Called from the verified webhook: confirm, open the deposit hold and the (held) owner payout. */
export function confirmPaidBooking(db: DB, b: Booking, providerRef: string, now: Date) {
  const iso = now.toISOString();
  run(db, "UPDATE calendar_blocks SET status = 'active', summary = 'booking' WHERE booking_id = ? AND source = 'booking'", b.id); // trigger re-checks
  run(db, "UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL, cancel_reason = NULL, cancelled_at = NULL WHERE id = ?", b.id);
  const l = listing(db, b.listing_id)!;
  if (b.security_deposit > 0)
    run(
      db,
      "INSERT OR IGNORE INTO deposit_holds (booking_id, amount, mode, status) VALUES (?,?,?, 'held')",
      b.id,
      b.security_deposit,
      b.pay_method === "card" ? "authorization" : "collected",
    );
  if (b.pay_method === "card" && b.security_deposit > 0)
    run(db, "INSERT INTO payments (booking_id, kind, method, amount_cents, status, provider_ref) VALUES (?, 'deposit', 'card', ?, 'authorized', ?)", b.id, b.security_deposit * 100, `auth_${providerRef}`);
  run(db, "INSERT OR IGNORE INTO payouts (booking_id, owner_id, amount, status) VALUES (?,?,?, 'held')", b.id, l.owner_id, b.owner_payout);
  audit(db, SYSTEM, "booking.confirmed", "booking", b.id, b.total, { providerRef, at: iso });
}

// ---------------- cancellation ----------------

/** Share of the nights refunded under a policy, from the snapshot taken at booking time. */
export function refundShare(policy: Policy, checkInAt: Date, now: Date): number {
  const days = (checkInAt.getTime() - now.getTime()) / 86_400_000;
  if (policy === "flexible") return days >= 1 ? 1 : 0;
  if (policy === "moderate") return days >= 14 ? 1 : days >= 7 ? 0.5 : 0;
  return days >= 30 ? 0.5 : 0;
}

export function checkInTime(db: DB, b: Pick<Booking, "check_in">, s: Settings = settings(db)) {
  return zonedToUtc(b.check_in, s.checkin_hour * 60, s.timezone);
}
export function checkOutTime(db: DB, b: Pick<Booking, "check_out">, s: Settings = settings(db)) {
  return zonedToUtc(b.check_out, s.checkout_hour * 60, s.timezone);
}

export async function cancelBooking(db: DB, bookingId: number, by: "guest" | "owner" | "admin", now: Date = new Date(), actor: { userId: number | null; name: string } = SYSTEM) {
  const b = booking(db, bookingId);
  if (!b) throw new MarketError("NOT_FOUND");
  if (b.status !== "confirmed") throw new MarketError("INVALID_STATE");
  // Owner or platform cancelling refunds the guest in full.
  const share = by === "guest" ? refundShare(b.policy, checkInTime(db, b), now) : 1;
  const refund = Math.round(b.nights_total * share) + (share === 1 ? b.service_fee : 0);
  const keptNights = b.nights_total - Math.round(b.nights_total * share);
  const ownerAmount = by === "guest" ? Math.round(keptNights * (1 - b.commission_pct / 100)) : 0;
  transaction(db, () => {
    run(db, "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, refund_amount = ? WHERE id = ?", now.toISOString(), by, refund, b.id);
    run(db, "UPDATE calendar_blocks SET status = 'released' WHERE booking_id = ? AND source = 'booking'", b.id);
    run(db, "UPDATE payouts SET amount = ?, status = CASE WHEN ? > 0 THEN 'releasable' ELSE 'cancelled' END, releasable_at = ? WHERE booking_id = ?", ownerAmount, ownerAmount, now.toISOString(), b.id);
    run(db, "UPDATE deposit_holds SET status = 'released', released_at = ?, note = 'booking cancelled' WHERE booking_id = ? AND status = 'held'", now.toISOString(), b.id);
    if (refund > 0) run(db, "INSERT INTO refunds (booking_id, amount, reason) VALUES (?,?,?)", b.id, refund, `cancelled by ${by} (${Math.round(share * 100)}%)`);
    audit(db, actor, "booking.cancelled", "booking", b.id, refund, { by, share, ownerAmount });
  });
  const charge = get<{ provider_ref: string | null }>(db, "SELECT provider_ref FROM payments WHERE booking_id = ? AND kind = 'charge' AND status = 'paid'", b.id);
  if (charge?.provider_ref && refund > 0) {
    await refundTransaction(charge.provider_ref, refund * 100);
    run(db, "UPDATE payments SET status = ? WHERE booking_id = ? AND kind = 'charge'", share === 1 ? "refunded" : "partially_refunded", b.id);
  }
  await notify(db, booking(db, b.id)!, "booking_cancelled", { refund });
  return { refund, share };
}

// ---------------- stay lifecycle ----------------

/** Guest taps "استلمت الشاليه": the stay starts and the owner payout becomes releasable. */
export async function guestCheckIn(db: DB, token: string, now: Date = new Date()) {
  const b = get<Booking>(db, "SELECT * FROM bookings WHERE public_token = ?", token);
  if (!b) throw new MarketError("NOT_FOUND");
  if (b.status !== "confirmed") throw new MarketError("INVALID_STATE");
  const s = settings(db);
  // On the demo platform the guest may "arrive" early so the flow can be tried any day.
  if (!s.demo && now.getTime() < zonedToUtc(addDays(b.check_in, 0), 0, s.timezone).getTime()) throw new MarketError("INVALID_STATE", "Too early");
  transaction(db, () => {
    run(db, "UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ?", now.toISOString(), b.id);
    run(db, "UPDATE payouts SET status = 'releasable', releasable_at = ? WHERE booking_id = ? AND status = 'held'", now.toISOString(), b.id);
    audit(db, { userId: null, name: "guest" }, "booking.checked_in", "booking", b.id, b.owner_payout);
  });
}

export function ownerReceives(nightsTotal: number, commissionPct: number) {
  return Math.round(nightsTotal * (1 - commissionPct / 100));
}

export function guestPhoneMasked(g: Guest | undefined) {
  return g ? `•••• ${g.phone_last4}` : "";
}

export function bookingPayoutStatus(db: DB, bookingId: number) {
  return get<{ status: string; amount: number; releasable_at: string | null; paid_at: string | null }>(db, "SELECT status, amount, releasable_at, paid_at FROM payouts WHERE booking_id = ?", bookingId);
}
