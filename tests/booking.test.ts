import { describe, expect, it } from "vitest";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { all, get, run } from "@/lib/db";
import { secret } from "@/lib/crypto";
import { computeTransactionHmac, sandboxTransaction } from "@/payments/paymob";
import { cancelBooking, completeBooking, createHold, guestCheckIn, isAvailable, validNationalId } from "@/market/booking";
import { handlePaymobCallback } from "@/market/payment-webhook";
import { openIssue, payReleasable, resolveIssue, runDueJobs } from "@/market/stay";
import { toggleNight } from "@/market/owner";
import { booking, ownerScope } from "@/market/repo";
import { freshDb, NAWRAS, NOW } from "./helpers";

const GUEST = { name: "سلمى عادل", phone: "01098765432", idType: "national_id" as const, idNumber: "29001011234567", method: "card" as const };

async function paidStay(db: ReturnType<typeof freshDb>["db"], checkIn: string, checkOut: string, now = NOW) {
  const hold = createHold(db, { listingId: NAWRAS, checkIn, checkOut, guests: 4 }, now);
  await completeBooking(db, hold.public_token, GUEST, { origin: "http://x" }, now);
  const pay = get<{ id: number; provider_order_id: string; amount_cents: number }>(db, "SELECT * FROM payments WHERE booking_id = ? AND kind = 'charge'", hold.id)!;
  const txn = sandboxTransaction({ id: 9000 + pay.id, orderId: pay.id, merchantOrderId: pay.provider_order_id, amountCents: pay.amount_cents, method: "card", success: true });
  const out = await handlePaymobCallback(db, { obj: txn }, computeTransactionHmac(txn, secret("PAYMOB_HMAC_SECRET")), now);
  return { b: booking(db, hold.id)!, txn, out, pay };
}

describe("holds and double booking", () => {
  it("rejects overlapping dates but allows a same-day turnover", () => {
    const { db } = freshDb();
    // seeded: Hamdy family 3–6 Aug 2027
    expect(() => createHold(db, { listingId: NAWRAS, checkIn: "2027-08-05", checkOut: "2027-08-07", guests: 2 }, NOW)).toThrow(/DATES_TAKEN/);
    expect(createHold(db, { listingId: NAWRAS, checkIn: "2027-08-06", checkOut: "2027-08-08", guests: 2 }, NOW).status).toBe("hold");
  });
  it("enforces min nights and capacity", () => {
    const { db } = freshDb();
    expect(() => createHold(db, { listingId: NAWRAS, checkIn: "2027-09-06", checkOut: "2027-09-07", guests: 2 }, NOW)).toThrow(/MIN_NIGHTS/);
    expect(() => createHold(db, { listingId: NAWRAS, checkIn: "2027-09-06", checkOut: "2027-09-09", guests: 12 }, NOW)).toThrow(/TOO_MANY_GUESTS/);
  });
  it("an expired hold frees the dates for the next guest", () => {
    const { db } = freshDb();
    createHold(db, { listingId: NAWRAS, checkIn: "2027-09-06", checkOut: "2027-09-09", guests: 2 }, NOW);
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(createHold(db, { listingId: NAWRAS, checkIn: "2027-09-07", checkOut: "2027-09-10", guests: 2 }, later).status).toBe("hold");
  });
  it("the database refuses an overlapping booking block whatever code writes it", () => {
    const { db } = freshDb();
    expect(() => run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source) VALUES (?, '2027-08-04', '2027-08-05', 'booking')", NAWRAS)).toThrow(/DATES_TAKEN/);
  });
  it("20 parallel requests for overlapping dates: exactly one wins", async () => {
    const { db, file } = freshDb();
    db.close();
    const startAt = Date.now() + 2500;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
          const w = new Worker(path.join(__dirname, "hold-worker.ts"), {
            execArgv: ["--import", "tsx"],
            workerData: { file, now: NOW.toISOString(), startAt, input: { listingId: NAWRAS, checkIn: `2027-09-${String(10 + (i % 3)).padStart(2, "0")}`, checkOut: "2027-09-14", guests: 2 } },
          });
          w.once("message", resolve);
          w.once("error", reject);
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "DATES_TAKEN")).toBe(true);
  });
});

describe("guest identity", () => {
  it("validates Egyptian national IDs", () => {
    expect(validNationalId("29001011234567")).toBe(true);
    expect(validNationalId("29013011234567")).toBe(false); // month 13
    expect(validNationalId("19001011234567")).toBe(false); // century digit
    expect(validNationalId("2900101123456")).toBe(false);
  });
  it("stores only the verification result and last 4 digits", async () => {
    const { db } = freshDb();
    const hold = createHold(db, { listingId: NAWRAS, checkIn: "2027-09-06", checkOut: "2027-09-09", guests: 2 }, NOW);
    await completeBooking(db, hold.public_token, GUEST, { origin: "http://x" }, NOW);
    const g = get<Record<string, unknown>>(db, "SELECT * FROM guests WHERE id = (SELECT guest_id FROM bookings WHERE id = ?)", hold.id)!;
    expect(g.id_status).toBe("verified");
    expect(g.id_last4).toBe("4567");
    expect(JSON.stringify(g)).not.toContain("29001011234567");
  });
  it("a wrong ID blocks the booking", async () => {
    const { db } = freshDb();
    const hold = createHold(db, { listingId: NAWRAS, checkIn: "2027-09-06", checkOut: "2027-09-09", guests: 2 }, NOW);
    await expect(completeBooking(db, hold.public_token, { ...GUEST, phone: "01111111111", idNumber: "123" }, { origin: "http://x" }, NOW)).rejects.toThrow(/ID_FAILED/);
  });
});

describe("payments, check-in and payouts", () => {
  it("pay → confirmed only from the verified webhook; replay and forgery do nothing", async () => {
    const { db } = freshDb();
    const hold = createHold(db, { listingId: NAWRAS, checkIn: "2027-09-06", checkOut: "2027-09-09", guests: 2 }, NOW);
    await completeBooking(db, hold.public_token, GUEST, { origin: "http://x" }, NOW);
    expect(booking(db, hold.id)!.status).toBe("pending_payment");
    const pay = get<{ id: number; provider_order_id: string; amount_cents: number }>(db, "SELECT * FROM payments WHERE booking_id = ?", hold.id)!;
    const txn = sandboxTransaction({ id: 777, orderId: 1, merchantOrderId: pay.provider_order_id, amountCents: pay.amount_cents, method: "card", success: true });
    expect((await handlePaymobCallback(db, { obj: txn }, "0".repeat(128), NOW)).status).toBe(401);
    const h = computeTransactionHmac(txn, secret("PAYMOB_HMAC_SECRET"));
    expect((await handlePaymobCallback(db, { obj: txn }, h, NOW)).result).toBe("confirmed");
    expect((await handlePaymobCallback(db, { obj: txn }, h, NOW)).result).toBe("duplicate");
    expect(booking(db, hold.id)!.status).toBe("confirmed");
    expect(get(db, "SELECT status FROM payouts WHERE booking_id = ?", hold.id)).toEqual(expect.objectContaining({ status: "held" }));
    expect(get(db, "SELECT mode, status FROM deposit_holds WHERE booking_id = ?", hold.id)).toEqual(expect.objectContaining({ mode: "authorization", status: "held" }));
  });

  it("pay → check-in → payout released → paid out, with commission applied", async () => {
    const { db } = freshDb({ demo: false });
    const { b } = await paidStay(db, "2026-10-20", "2026-10-23");
    const arrival = new Date("2026-10-20T13:00:00Z");
    await guestCheckIn(db, b.public_token, arrival);
    const p = get<{ status: string; amount: number }>(db, "SELECT status, amount FROM payouts WHERE booking_id = ?", b.id)!;
    expect(p.status).toBe("releasable");
    expect(p.amount).toBe(Math.round(b.nights_total * 0.88));
    const r = payReleasable(db, { userId: 1, name: "admin" }, arrival);
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(get(db, "SELECT status FROM payouts WHERE booking_id = ?", b.id)).toEqual({ status: "paid" });
  });

  it("no tap and no issue: payout becomes releasable 6 hours after check-in time", async () => {
    const { db } = freshDb({ demo: false });
    const { b } = await paidStay(db, "2026-10-20", "2026-10-23");
    await runDueJobs(db, new Date("2026-10-20T17:00:00Z"), { syncFeeds: false }); // 19:00 Cairo, 4h after 15:00
    expect(get(db, "SELECT status FROM payouts WHERE booking_id = ?", b.id)).toEqual({ status: "held" });
    await runDueJobs(db, new Date("2026-10-20T18:01:00Z"), { syncFeeds: false }); // 21:01 Cairo
    expect(get(db, "SELECT status FROM payouts WHERE booking_id = ?", b.id)).toEqual({ status: "releasable" });
  });

  it("an open issue freezes the payout until an admin resolves it", async () => {
    const { db } = freshDb({ demo: false });
    const { b } = await paidStay(db, "2026-10-20", "2026-10-23");
    await guestCheckIn(db, b.public_token, new Date("2026-10-20T13:00:00Z"));
    const issue = openIssue(db, b.id, "guest", "not_as_described", "التكييف في الأوضة الكبيرة مش شغال");
    expect(get(db, "SELECT status FROM payouts WHERE booking_id = ?", b.id)).toEqual({ status: "frozen" });
    expect(payReleasable(db, { userId: 1, name: "a" }).count).toBe(0);
    await resolveIssue(db, issue, { userId: 1, name: "admin" }, "refund_guest", 1000, "خصم يوم");
    const p = get<{ status: string; amount: number }>(db, "SELECT status, amount FROM payouts WHERE booking_id = ?", b.id)!;
    expect(p.status).toBe("releasable");
    expect(p.amount).toBe(Math.round(b.nights_total * 0.88) - Math.round(1000 * 0.88));
  });

  it("deposit is released after check-out unless the owner reports damage", async () => {
    const { db } = freshDb({ demo: false });
    const a = await paidStay(db, "2026-10-20", "2026-10-23");
    const c = await paidStay(db, "2026-10-24", "2026-10-27");
    await guestCheckIn(db, a.b.public_token, new Date("2026-10-20T13:00:00Z"));
    await guestCheckIn(db, c.b.public_token, new Date("2026-10-24T13:00:00Z"));
    await runDueJobs(db, new Date("2026-10-27T10:00:00Z"), { syncFeeds: false }); // both checked out
    openIssue(db, c.b.id, "owner", "damage", "كسر في باب البلكونة");
    await runDueJobs(db, new Date("2026-10-30T10:00:00Z"), { syncFeeds: false });
    expect(get(db, "SELECT status FROM deposit_holds WHERE booking_id = ?", a.b.id)).toEqual({ status: "released" });
    expect(get(db, "SELECT status FROM deposit_holds WHERE booking_id = ?", c.b.id)).toEqual({ status: "held" });
    const msgs = all<{ template: string }>(db, "SELECT template FROM message_log WHERE booking_id = ?", a.b.id).map((m) => m.template);
    expect(msgs).toEqual(expect.arrayContaining(["booking_confirmed", "review_request", "deposit_returned"]));
  });

  it("arrival details (with address and handover contact) go out the evening before, then the check-in prompt", async () => {
    const { db } = freshDb({ demo: false });
    const { b } = await paidStay(db, "2026-10-20", "2026-10-23");
    await runDueJobs(db, new Date("2026-10-19T14:00:00Z"), { syncFeeds: false }); // 17:00 Cairo the day before
    expect(get(db, "SELECT 1 AS x FROM message_log WHERE booking_id = ? AND template = 'arrival_details'", b.id)).toBeUndefined();
    await runDueJobs(db, new Date("2026-10-19T15:30:00Z"), { syncFeeds: false }); // 18:30 Cairo
    const arrival = get<{ body: string }>(db, "SELECT body FROM message_log WHERE booking_id = ? AND template = 'arrival_details'", b.id)!;
    expect(arrival.body).toContain("building 7");
    await runDueJobs(db, new Date("2026-10-20T12:05:00Z"), { syncFeeds: false }); // 15:05 Cairo, check-in time
    expect(get(db, "SELECT 1 AS x FROM message_log WHERE booking_id = ? AND template = 'checkin_prompt'", b.id)).toBeTruthy();
    await runDueJobs(db, new Date("2026-10-20T12:30:00Z"), { syncFeeds: false });
    expect(all(db, "SELECT 1 FROM message_log WHERE booking_id = ? AND template = 'arrival_details'", b.id)).toHaveLength(1);
  });
});

describe("cancellation policies (snapshot at booking time)", () => {
  const cases: [string, string, Date, number][] = [
    ["moderate: >14 days → full refund", "moderate", new Date("2027-08-01T00:00:00Z"), 1],
    ["moderate: 7–14 days → 50%", "moderate", new Date("2027-08-28T00:00:00Z"), 0.5],
    ["moderate: <7 days → nothing", "moderate", new Date("2027-09-03T00:00:00Z"), 0],
    ["flexible: >24h → full", "flexible", new Date("2027-09-04T00:00:00Z"), 1],
    ["strict: >30 days → 50%", "strict", new Date("2027-07-01T00:00:00Z"), 0.5],
    ["strict: <30 days → nothing", "strict", new Date("2027-08-20T00:00:00Z"), 0],
  ];
  for (const [name, policy, at, share] of cases)
    it(name, async () => {
      const { db } = freshDb();
      run(db, "UPDATE listings SET cancellation_policy = ? WHERE id = ?", policy, NAWRAS);
      const { b } = await paidStay(db, "2027-09-06", "2027-09-09");
      run(db, "UPDATE listings SET cancellation_policy = 'flexible' WHERE id = ?", NAWRAS); // later change must not matter
      const r = await cancelBooking(db, b.id, "guest", at);
      expect(r.share).toBe(share);
      expect(r.refund).toBe(Math.round(b.nights_total * share) + (share === 1 ? b.service_fee : 0));
      expect(isAvailable(db, NAWRAS, "2027-09-06", "2027-09-09")).toBe(true);
    });
});

describe("owner isolation", () => {
  it("owner A can't see or block owner B's listings", () => {
    const { db } = freshDb();
    const sherif = get<{ id: number }>(db, "SELECT o.id FROM owners o JOIN users u ON u.id = o.user_id WHERE u.email = 'sherif@masyaf.example'")!.id;
    const dalia = get<{ id: number }>(db, "SELECT o.id FROM owners o JOIN users u ON u.id = o.user_id WHERE u.email = 'dalia@masyaf.example'")!.id;
    const daliaListing = ownerScope(db, dalia).listings()[0]!;
    expect(ownerScope(db, sherif).listing(daliaListing.id)).toBeUndefined();
    expect(ownerScope(db, sherif).bookings(daliaListing.id)).toEqual([]);
    expect(() => toggleNight(db, sherif, daliaListing.id, "2027-09-01", { userId: null, name: "x" })).toThrow(/FORBIDDEN/);
  });
  it("owner can't block a booked night but can block and reopen a free one", () => {
    const { db } = freshDb();
    const sherif = get<{ id: number }>(db, "SELECT owner_id AS id FROM listings WHERE id = ?", NAWRAS)!.id;
    expect(() => toggleNight(db, sherif, NAWRAS, "2027-08-04", { userId: null, name: "x" })).toThrow(/DATES_TAKEN/);
    expect(toggleNight(db, sherif, NAWRAS, "2027-09-01", { userId: null, name: "x" })).toBe("blocked");
    expect(isAvailable(db, NAWRAS, "2027-08-31", "2027-09-03")).toBe(false);
    expect(toggleNight(db, sherif, NAWRAS, "2027-09-01", { userId: null, name: "x" })).toBe("opened");
    expect(isAvailable(db, NAWRAS, "2027-08-31", "2027-09-03")).toBe(true);
  });
});
