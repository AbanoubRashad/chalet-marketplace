import { get, run, transaction, type DB } from "@/lib/db";
import { secret } from "@/lib/crypto";
import { redactTransaction, verifyTransactionHmac, type PaymobTransaction } from "@/payments/paymob";
import { confirmPaidBooking } from "./booking";
import { notify } from "./messages";
import { audit, booking, SYSTEM } from "./repo";

/**
 * Paymob transaction callback: HMAC first (forgery → 401), idempotency key second (replay → no-op),
 * amount check, then the state change in one transaction. Only this confirms a booking.
 */
export async function handlePaymobCallback(db: DB, body: unknown, hmac: string | null, now: Date = new Date()) {
  const obj = (body as { obj?: PaymobTransaction })?.obj;
  if (!obj || obj.id === undefined) return { status: 400, result: "bad_request" } as const;
  if (!verifyTransactionHmac(obj, hmac, secret("PAYMOB_HMAC_SECRET"))) return { status: 401, result: "invalid_signature" } as const;
  try {
    run(db, "INSERT INTO webhook_events (provider, event_key) VALUES ('paymob', ?)", `txn:${obj.id}:${obj.success}:${obj.pending}`);
  } catch {
    return { status: 200, result: "duplicate" } as const;
  }
  const merchantRef = String(obj.order?.merchant_order_id ?? "");
  const pay = get<{ id: number; booking_id: number; amount_cents: number }>(db, "SELECT * FROM payments WHERE provider_order_id = ?", merchantRef);
  if (!pay) return { status: 200, result: "ignored" } as const;
  const raw = JSON.stringify(redactTransaction(obj));
  if (Number(obj.amount_cents) !== pay.amount_cents) {
    audit(db, SYSTEM, "payment.amount_mismatch", "payment", pay.id, Number(obj.amount_cents) / 100);
    return { status: 200, result: "amount_mismatch" } as const;
  }
  if (!obj.success) {
    transaction(db, () => {
      run(db, "UPDATE payments SET status = 'failed', provider_ref = ?, raw_payload = ? WHERE id = ?", String(obj.id), raw, pay.id);
      run(db, "UPDATE bookings SET status = 'cancelled', cancel_reason = 'payment_failed', cancelled_at = ? WHERE id = ? AND status = 'pending_payment'", now.toISOString(), pay.booking_id);
      run(db, "UPDATE calendar_blocks SET status = 'released' WHERE booking_id = ? AND source = 'booking'", pay.booking_id);
    });
    return { status: 200, result: "failed" } as const;
  }
  const outcome = transaction(db, () => {
    run(db, "UPDATE payments SET status = 'paid', provider_ref = ?, raw_payload = ?, updated_at = ? WHERE id = ?", String(obj.id), raw, now.toISOString(), pay.id);
    audit(db, SYSTEM, "payment.received", "payment", pay.id, pay.amount_cents / 100);
    const b = booking(db, pay.booking_id)!;
    if (b.status === "confirmed") return "confirmed" as const;
    const revivable = b.status === "hold" || b.status === "pending_payment" || (b.status === "cancelled" && b.cancel_reason === "hold_expired");
    if (!revivable) return "needs_refund" as const;
    try {
      // savepoint so a failed revival (dates taken meanwhile) doesn't roll back the payment record
      return transaction(db, () => {
        confirmPaidBooking(db, b, String(obj.id), now);
        return "confirmed" as const;
      });
    } catch (err) {
      if (!(err instanceof Error) || !/DATES_TAKEN/.test(err.message)) throw err;
      audit(db, SYSTEM, "payment.needs_refund", "payment", pay.id, pay.amount_cents / 100, { reason: "dates taken after hold expired" });
      return "needs_refund" as const;
    }
  });
  if (outcome === "confirmed") {
    const b = booking(db, pay.booking_id)!;
    await notify(db, b, "booking_confirmed");
  }
  return { status: 200, result: outcome } as const;
}
