import { all, get, run, transaction, type DB } from "@/lib/db";
import { addDays, nightsBetween, priceNight } from "@/booking-engine";
import { MarketError } from "./booking";
import { activeBlocks, audit, ownerScope, priceRules } from "./repo";
import { syncFeed } from "./ical";
import type { Listing } from "./types";

type Actor = { userId: number | null; name: string };

function mine(db: DB, ownerId: number, listingId: number): Listing {
  const l = ownerScope(db, ownerId).listing(listingId);
  if (!l) throw new MarketError("FORBIDDEN");
  return l;
}

export interface OwnerDay {
  date: string;
  state: "free" | "ours" | "ext" | "blk";
  label: string;
  conflict: boolean;
  blockId: number | null;
}

export function ownerMonth(db: DB, ownerId: number, listingId: number, month: string): OwnerDay[] {
  mine(db, ownerId, listingId);
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const blocks = activeBlocks(db, listingId, first, next);
  const rules = priceRules(db, listingId);
  return nightsBetween(first, next).map((date) => {
    const covering = blocks.filter((b) => b.start_date <= date && b.end_date > date);
    const booking = covering.find((b) => b.source === "booking");
    const ext = covering.find((b) => b.source === "ical_import");
    const blk = covering.find((b) => b.source === "owner_block");
    const tier = priceNight(date, rules).tier;
    if (booking) return { date, state: "ours", label: "محجوز", conflict: Boolean(ext), blockId: null };
    if (ext) return { date, state: "ext", label: ext.summary.split(" · ")[0] || "خارجي", conflict: false, blockId: null };
    if (blk) return { date, state: "blk", label: "مقفول", conflict: false, blockId: blk.id };
    return { date, state: "free", label: tier === "season" ? "موسم" : tier === "weekend" ? "ويك إند" : "عادي", conflict: false, blockId: null };
  });
}

/** Click a free night to block it, click an owner-blocked night to open it. Booked nights can't be blocked (DB trigger). */
export function toggleNight(db: DB, ownerId: number, listingId: number, date: string, actor: Actor) {
  mine(db, ownerId, listingId);
  return transaction(db, () => {
    const blk = get<{ id: number; start_date: string; end_date: string }>(
      db,
      "SELECT id, start_date, end_date FROM calendar_blocks WHERE listing_id = ? AND status = 'active' AND source = 'owner_block' AND start_date <= ? AND end_date > ?",
      listingId,
      date,
      date,
    );
    if (blk) {
      // split the block around the reopened night
      run(db, "UPDATE calendar_blocks SET status = 'released' WHERE id = ?", blk.id);
      if (blk.start_date < date) run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, summary) VALUES (?,?,?, 'owner_block', 'مقفول من المالك')", listingId, blk.start_date, date);
      if (addDays(date, 1) < blk.end_date) run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, summary) VALUES (?,?,?, 'owner_block', 'مقفول من المالك')", listingId, addDays(date, 1), blk.end_date);
      audit(db, actor, "calendar.opened", "listing", listingId, null, { date });
      return "opened";
    }
    try {
      run(db, "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, summary) VALUES (?,?,?, 'owner_block', 'مقفول من المالك')", listingId, date, addDays(date, 1));
    } catch (err) {
      if (err instanceof Error && /DATES_TAKEN/.test(err.message)) throw new MarketError("DATES_TAKEN");
      throw err;
    }
    audit(db, actor, "calendar.blocked", "listing", listingId, null, { date });
    return "blocked";
  });
}

export function setPlan(db: DB, ownerId: number, plan: "commission" | "managed", actor: Actor) {
  run(db, "UPDATE owners SET plan = ? WHERE id = ?", plan, ownerId);
  audit(db, actor, "owner.plan_changed", "owner", ownerId, null, { plan, appliesTo: "new bookings" });
}

export function savePricing(
  db: DB,
  ownerId: number,
  listingId: number,
  input: { base: number; baseMin: number; upliftPct: number; upliftDays: number[]; weeklyPct: number },
  actor: Actor,
) {
  mine(db, ownerId, listingId);
  if (!(input.base > 0) || input.baseMin < 1 || input.upliftPct < 0 || input.weeklyPct < 0 || input.weeklyPct > 50) throw new MarketError("INVALID_STATE", "قيم غير صحيحة");
  transaction(db, () => {
    run(db, "DELETE FROM price_rules WHERE listing_id = ? AND type IN ('base','weekday_uplift')", listingId);
    run(db, "INSERT INTO price_rules (listing_id, type, label, amount, min_nights) VALUES (?, 'base', 'سعر الليلة العادي', ?, ?)", listingId, Math.round(input.base), input.baseMin);
    if (input.upliftPct > 0 && input.upliftDays.length)
      run(db, "INSERT INTO price_rules (listing_id, type, label, percent, weekdays) VALUES (?, 'weekday_uplift', 'الويك إند', ?, ?)", listingId, input.upliftPct, input.upliftDays.join(","));
    run(db, "DELETE FROM los_discounts WHERE listing_id = ?", listingId);
    if (input.weeklyPct > 0) run(db, "INSERT INTO los_discounts (listing_id, min_nights, percent, label) VALUES (?, 7, ?, 'خصم الإقامة الأسبوعية')", listingId, input.weeklyPct);
    audit(db, actor, "pricing.updated", "listing", listingId, null, input);
  });
}

export function addSeason(db: DB, ownerId: number, listingId: number, input: { label: string; from: string; to: string; amount: number; minNights: number }, actor: Actor) {
  mine(db, ownerId, listingId);
  if (!(input.to > input.from) || !(input.amount > 0)) throw new MarketError("INVALID_STATE", "راجع تواريخ وسعر الموسم");
  run(db, "INSERT INTO price_rules (listing_id, type, label, start_date, end_date, amount, min_nights, priority) VALUES (?, 'season', ?, ?, ?, ?, ?, 10)", listingId, input.label || "موسم", input.from, addDays(input.to, 1), input.amount, input.minNights || null);
  audit(db, actor, "pricing.season_added", "listing", listingId, null, input);
}

export function removeRule(db: DB, ownerId: number, listingId: number, ruleId: number, actor: Actor) {
  mine(db, ownerId, listingId);
  run(db, "DELETE FROM price_rules WHERE id = ? AND listing_id = ? AND type = 'season'", ruleId, listingId);
  audit(db, actor, "pricing.season_removed", "listing", listingId, null, { ruleId });
}

export function saveDepositPolicy(db: DB, ownerId: number, listingId: number, deposit: number, policy: string, actor: Actor) {
  mine(db, ownerId, listingId);
  if (!["flexible", "moderate", "strict"].includes(policy) || deposit < 0) throw new MarketError("INVALID_STATE");
  run(db, "UPDATE listings SET security_deposit = ?, cancellation_policy = ? WHERE id = ?", Math.round(deposit), policy, listingId);
  audit(db, actor, "listing.deposit_policy", "listing", listingId, deposit, { policy, appliesTo: "new bookings" });
}

export function addFeed(db: DB, ownerId: number, listingId: number, provider: string, url: string, actor: Actor) {
  mine(db, ownerId, listingId);
  if (!/^https?:\/\/\S+$/.test(url) && !url.startsWith("/api/demo-feeds/")) throw new MarketError("INVALID_STATE", "رابط iCal غير صحيح");
  const id = run(db, "INSERT INTO ical_feeds (listing_id, provider, url) VALUES (?,?,?)", listingId, provider, url).id;
  audit(db, actor, "ical.feed_added", "ical_feed", id, null, { provider });
  return id;
}

export async function syncListingFeeds(db: DB, ownerId: number, listingId: number) {
  mine(db, ownerId, listingId);
  const feeds = all<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE listing_id = ?", listingId);
  const results = [];
  for (const f of feeds) results.push(await syncFeed(db, f.id));
  return results;
}

/** Monthly owner statement: stays that checked in during the month, gross, commission, net and payout status. */
export function ownerStatement(db: DB, ownerId: number, month: string) {
  return all<{ ref: string; title_ar: string; check_in: string; check_out: string; nights_total: number; commission_pct: number; payout: number; payout_status: string; plan: string }>(
    db,
    `SELECT b.ref, l.title_ar, b.check_in, b.check_out, b.nights_total, b.commission_pct, p.amount AS payout, p.status AS payout_status, b.plan
       FROM payouts p JOIN bookings b ON b.id = p.booking_id JOIN listings l ON l.id = b.listing_id
      WHERE p.owner_id = ? AND substr(b.check_in, 1, 7) = ? ORDER BY b.check_in`,
    ownerId,
    month,
  );
}
