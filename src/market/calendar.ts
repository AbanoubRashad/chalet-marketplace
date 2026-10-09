import type { DB } from "@/lib/db";
import { addDays, nightsBetween, priceNight, todayIn } from "@/booking-engine";
import { activeBlocks, priceRules, settings } from "./repo";

/** One month of nights for a listing: price tier, min nights, taken, past. */
export function monthDays(d: DB, listingId: number, month: string) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const today = todayIn(settings(d).timezone);
  const rules = priceRules(d, listingId);
  const taken = new Set<string>();
  for (const b of activeBlocks(d, listingId, first, addDays(next, 1))) for (const n of nightsBetween(b.start_date, b.end_date)) taken.add(n);
  return nightsBetween(first, next).map((date) => {
    const p = priceNight(date, rules);
    return { date, amount: p.amount, tier: p.tier, minNights: p.minNights, blocked: taken.has(date), past: date < today };
  });
}
