// After payment: issues (freeze payouts), reviews (verified only), payouts batch, deposit release, jobs.
import { all, get, run, transaction, type DB } from "@/lib/db";
import { refundTransaction } from "@/payments/paymob";
import { addDays } from "@/booking-engine";
import { checkInTime, checkOutTime, MarketError } from "./booking";
import { notify } from "./messages";
import { audit, booking, settings, SYSTEM } from "./repo";
import { syncAllFeeds } from "./ical";
import type { Booking } from "./types";

type Actor = { userId: number | null; name: string };

export function openIssue(db: DB, bookingId: number, raisedBy: "guest" | "owner", type: "not_as_described" | "access" | "damage" | "other", description: string, evidence = "", now = new Date()) {
  const b = booking(db, bookingId);
  if (!b || !["confirmed", "checked_in", "completed", "disputed"].includes(b.status)) throw new MarketError("INVALID_STATE");
  if (description.trim().length < 5) throw new MarketError("INVALID_STATE", "describe the issue");
  return transaction(db, () => {
    const { id } = run(db, "INSERT INTO issues (booking_id, raised_by, type, description, evidence, created_at) VALUES (?,?,?,?,?,?)", b.id, raisedBy, type, description.trim(), evidence.trim(), now.toISOString());
    // Money stops moving while there is an open issue.
    run(db, "UPDATE payouts SET status = 'frozen' WHERE booking_id = ? AND status IN ('held','releasable')", b.id);
    if (b.status !== "completed") run(db, "UPDATE bookings SET status = 'disputed' WHERE id = ?", b.id);
    audit(db, { userId: null, name: raisedBy }, "issue.opened", "issue", id, null, { bookingId: b.id, type });
    return id;
  });
}

/** Admin resolution. refund_guest: refund amount to guest; capture_deposit: keep part of the deposit for the owner; pay_owner: unfreeze. */
export async function resolveIssue(
  db: DB,
  issueId: number,
  admin: Actor,
  resolution: "refund_guest" | "capture_deposit" | "pay_owner",
  amount: number,
  note: string,
  now = new Date(),
) {
  const issue = get<{ id: number; booking_id: number; status: string }>(db, "SELECT * FROM issues WHERE id = ?", issueId);
  if (!issue || issue.status !== "open") throw new MarketError("INVALID_STATE");
  const b = booking(db, issue.booking_id)!;
  transaction(db, () => {
    run(db, "UPDATE issues SET status = 'resolved', resolution = ?, resolution_note = ?, amount = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", resolution, note, amount, admin.userId, now.toISOString(), issueId);
    if (resolution === "refund_guest") {
      const amt = Math.min(Math.max(0, amount), b.nights_total);
      run(db, "INSERT INTO refunds (booking_id, amount, reason) VALUES (?,?,?)", b.id, amt, `issue #${issueId}`);
      run(db, "UPDATE bookings SET refund_amount = refund_amount + ? WHERE id = ?", amt, b.id);
      run(db, "UPDATE payouts SET amount = MAX(0, amount - ?) WHERE booking_id = ?", Math.round(amt * (1 - b.commission_pct / 100)), b.id);
      audit(db, admin, "refund.issued", "booking", b.id, amt, { issueId });
    }
    if (resolution === "capture_deposit") {
      const amt = Math.min(Math.max(0, amount), b.security_deposit);
      run(db, "UPDATE deposit_holds SET status = 'captured', captured_amount = ?, released_at = ?, note = ? WHERE booking_id = ?", amt, now.toISOString(), `issue #${issueId}`, b.id);
      run(db, "UPDATE payouts SET amount = amount + ? WHERE booking_id = ?", amt, b.id);
      audit(db, admin, "deposit.captured", "booking", b.id, amt, { issueId });
    }
    const stillOpen = get(db, "SELECT 1 FROM issues WHERE booking_id = ? AND status = 'open'", b.id);
    if (!stillOpen) {
      run(db, "UPDATE payouts SET status = 'releasable', releasable_at = ? WHERE booking_id = ? AND status = 'frozen'", now.toISOString(), b.id);
      if (b.status === "disputed") run(db, "UPDATE bookings SET status = CASE WHEN checked_out_at IS NOT NULL THEN 'completed' WHEN checked_in_at IS NOT NULL THEN 'checked_in' ELSE 'confirmed' END WHERE id = ?", b.id);
    }
  });
  if (resolution === "refund_guest") {
    const charge = get<{ provider_ref: string | null }>(db, "SELECT provider_ref FROM payments WHERE booking_id = ? AND kind = 'charge' AND status IN ('paid','partially_refunded')", b.id);
    if (charge?.provider_ref) await refundTransaction(charge.provider_ref, amount * 100);
  }
}

export function addReview(db: DB, token: string, rating: number, text: string, now = new Date()) {
  const b = get<Booking>(db, "SELECT * FROM bookings WHERE public_token = ?", token);
  if (!b || b.status !== "completed") throw new MarketError("INVALID_STATE", "Only completed stays can be reviewed");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new MarketError("INVALID_STATE");
  const g = get<{ name: string }>(db, "SELECT name FROM guests WHERE id = ?", b.guest_id)!;
  try {
    run(db, "INSERT INTO reviews (booking_id, listing_id, author_side, author_name, rating, text, created_at) VALUES (?,?, 'guest', ?,?,?,?)", b.id, b.listing_id, g.name, rating, text.trim().slice(0, 1000), now.toISOString());
  } catch {
    throw new MarketError("INVALID_STATE", "Already reviewed");
  }
}

export function ownerReply(db: DB, ownerId: number, reviewId: number, reply: string, now = new Date()) {
  const r = get<{ id: number; reply: string | null }>(
    db,
    "SELECT v.id, v.reply FROM reviews v JOIN listings l ON l.id = v.listing_id WHERE v.id = ? AND l.owner_id = ?",
    reviewId,
    ownerId,
  );
  if (!r) throw new MarketError("FORBIDDEN");
  if (r.reply) throw new MarketError("INVALID_STATE", "One reply per review");
  run(db, "UPDATE reviews SET reply = ?, reply_at = ? WHERE id = ?", reply.trim().slice(0, 600), now.toISOString(), reviewId);
}

/** Admin payout batch: pay everything releasable. */
export function payReleasable(db: DB, admin: Actor, now = new Date()) {
  const batch = `B-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.getTime() % 10000}`;
  return transaction(db, () => {
    const rows = all<{ id: number; amount: number }>(db, "SELECT id, amount FROM payouts WHERE status = 'releasable'");
    for (const p of rows) {
      run(db, "UPDATE payouts SET status = 'paid', paid_at = ?, batch_ref = ? WHERE id = ?", now.toISOString(), batch, p.id);
      audit(db, admin, "payout.paid", "payout", p.id, p.amount, { batch });
    }
    return { batch, count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) };
  });
}

export interface JobReport {
  holds: number;
  autoCheckins: number;
  completed: number;
  depositsReleased: number;
  messages: number;
  feeds: number;
}

/**
 * Runs every minute (and with a fake clock in tests):
 * holds expiry · arrival details the day before · check-in prompt · auto check-in after N hours ·
 * check-out (complete + review request) · deposit release · iCal sync every N minutes.
 */
export async function runDueJobs(db: DB, now: Date = new Date(), opts: { syncFeeds?: boolean } = {}): Promise<JobReport> {
  const s = settings(db);
  const iso = now.toISOString();
  const r: JobReport = { holds: 0, autoCheckins: 0, completed: 0, depositsReleased: 0, messages: 0, feeds: 0 };
  const { sweepHolds } = await import("./booking");
  r.holds = transaction(db, () => sweepHolds(db, now));

  const active = all<Booking & { arrival_sent_at: string | null; checkin_prompt_sent_at: string | null; checkout_reminder_sent_at: string | null; review_request_sent_at: string | null }>(
    db,
    "SELECT * FROM bookings WHERE status IN ('confirmed','checked_in','completed','disputed') AND check_out >= ?",
    addDays(now.toISOString().slice(0, 10), -5),
  );
  for (const b of active) {
    const ci = checkInTime(db, b, s);
    const co = checkOutTime(db, b, s);
    const claim = (col: string) => run(db, `UPDATE bookings SET ${col} = ? WHERE id = ? AND ${col} IS NULL`, iso, b.id).changes === 1;
    // arrival details: from 18:00 the evening before (address + handover contact revealed only now that it's paid)
    if (b.status === "confirmed" && now.getTime() >= ci.getTime() - 21 * 3_600_000 && now < co && claim("arrival_sent_at")) {
      await notify(db, b, "arrival_details");
      r.messages++;
    }
    if (b.status === "confirmed" && now >= ci && claim("checkin_prompt_sent_at")) {
      await notify(db, b, "checkin_prompt");
      r.messages++;
    }
    // no tap and no issue N hours after check-in time -> treat as checked in, payout releasable
    if (b.status === "confirmed" && now.getTime() >= ci.getTime() + s.payout_release_hours * 3_600_000) {
      transaction(db, () => {
        run(db, "UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ? AND status = 'confirmed'", iso, b.id);
        run(db, "UPDATE payouts SET status = 'releasable', releasable_at = ? WHERE booking_id = ? AND status = 'held'", iso, b.id);
        audit(db, SYSTEM, "booking.auto_checked_in", "booking", b.id, b.owner_payout);
      });
      r.autoCheckins++;
    }
    if ((b.status === "checked_in" || b.status === "confirmed") && now.getTime() >= co.getTime() - 4 * 3_600_000 && now < co && claim("checkout_reminder_sent_at")) {
      await notify(db, b, "checkout_reminder");
      r.messages++;
    }
    if (b.status === "checked_in" && now >= co) {
      transaction(db, () => {
        run(db, "UPDATE bookings SET status = 'completed', checked_out_at = ? WHERE id = ?", iso, b.id);
        // deposit returned automatically within deposit_return_days unless the owner reports damage before then
        run(db, "UPDATE deposit_holds SET release_due_at = ? WHERE booking_id = ? AND status = 'held'", new Date(co.getTime() + (s.deposit_return_days - 1) * 86_400_000).toISOString(), b.id);
      });
      r.completed++;
      if (claim("review_request_sent_at")) {
        await notify(db, { ...b, status: "completed" }, "review_request");
        r.messages++;
      }
    }
  }

  const due = all<{ booking_id: number; amount: number }>(
    db,
    `SELECT d.booking_id, d.amount FROM deposit_holds d
      WHERE d.status = 'held' AND d.release_due_at IS NOT NULL AND d.release_due_at <= ?
        AND NOT EXISTS (SELECT 1 FROM issues i WHERE i.booking_id = d.booking_id AND i.status = 'open' AND i.type = 'damage')`,
    iso,
  );
  for (const d of due) {
    transaction(db, () => {
      run(db, "UPDATE deposit_holds SET status = 'released', released_at = ? WHERE booking_id = ?", iso, d.booking_id);
      run(db, "UPDATE payments SET status = 'voided' WHERE booking_id = ? AND kind = 'deposit' AND status = 'authorized'", d.booking_id);
      audit(db, SYSTEM, "deposit.released", "booking", d.booking_id, d.amount);
    });
    // wallet payments included the deposit in the charge: refund that part now
    const collected = get<{ mode: string }>(db, "SELECT mode FROM deposit_holds WHERE booking_id = ?", d.booking_id);
    const charge = get<{ provider_ref: string | null }>(db, "SELECT provider_ref FROM payments WHERE booking_id = ? AND kind = 'charge' AND status = 'paid'", d.booking_id);
    if (collected?.mode === "collected" && charge?.provider_ref) {
      await refundTransaction(charge.provider_ref, d.amount * 100);
      run(db, "INSERT INTO refunds (booking_id, amount, reason) VALUES (?,?, 'deposit returned')", d.booking_id, d.amount);
    }
    await notify(db, booking(db, d.booking_id)!, "deposit_returned");
    r.depositsReleased++;
  }

  if (opts.syncFeeds !== false) r.feeds = (await syncAllFeeds(db, now, s.ical_sync_minutes)).length;
  return r;
}

/** Demo platforms only: jump one stay through check-out so the review and deposit flow can be shown today. */
export async function demoCheckout(db: DB, token: string, now = new Date()) {
  const b = get<Booking>(db, "SELECT * FROM bookings WHERE public_token = ?", token);
  if (!b || b.status !== "checked_in" || !settings(db).demo) throw new MarketError("INVALID_STATE");
  transaction(db, () => {
    run(db, "UPDATE bookings SET status = 'completed', checked_out_at = ?, review_request_sent_at = ? WHERE id = ?", now.toISOString(), now.toISOString(), b.id);
    run(db, "UPDATE deposit_holds SET status = 'released', released_at = ?, note = 'demo checkout' WHERE booking_id = ? AND status = 'held'", now.toISOString(), b.id);
    audit(db, SYSTEM, "deposit.released", "booking", b.id, b.security_deposit, { demo: true });
  });
  await notify(db, { ...b, status: "completed" }, "deposit_returned");
  await notify(db, { ...b, status: "completed" }, "review_request");
}
