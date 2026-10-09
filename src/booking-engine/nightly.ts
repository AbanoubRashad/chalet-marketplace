// Nightly-stay mode of the generic booking engine (check-in / check-out dates), alongside the
// time-slot mode in availability.ts. Pure functions: no I/O, no vertical-specific imports.
import { addDays, weekdayOf } from "./time";

/** Dates are local calendar days "YYYY-MM-DD". Ranges are half-open: [start, end). */
export type LocalDate = string;

export type PriceRuleType = "base" | "weekday_uplift" | "season";
export type NightTier = "regular" | "weekend" | "season";

export interface PriceRule {
  id: number;
  type: PriceRuleType;
  /** inclusive start / exclusive end; null = unbounded */
  startDate?: LocalDate | null;
  endDate?: LocalDate | null;
  /** 0 = Sunday … 6 = Saturday; null = every day */
  weekdays?: number[] | null;
  /** fixed nightly amount (base, season) */
  amount?: number | null;
  /** percentage on top of the base (weekday uplift, or a season expressed as %) */
  percent?: number | null;
  minNights?: number | null;
  /** higher wins among rules of the same type */
  priority?: number;
  label?: string;
}

export interface LengthOfStayDiscount {
  minNights: number;
  percent: number;
  label?: string;
}

export interface NightPrice {
  date: LocalDate;
  amount: number;
  tier: NightTier;
  ruleId: number | null;
  minNights: number;
}

export function nightsBetween(checkIn: LocalDate, checkOut: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}

export function rangesOverlap(aStart: LocalDate, aEnd: LocalDate, bStart: LocalDate, bEnd: LocalDate): boolean {
  // half-open: a check-out day can be the next guest's check-in day
  return aStart < bEnd && aEnd > bStart;
}

const inRange = (r: PriceRule, date: LocalDate) => (!r.startDate || date >= r.startDate) && (!r.endDate || date < r.endDate);
const onDay = (r: PriceRule, date: LocalDate) => !r.weekdays || r.weekdays.length === 0 || r.weekdays.includes(weekdayOf(date));
const best = (rules: PriceRule[]) => [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.id - a.id)[0];
/** Uplifted prices are rounded to the nearest 50 EGP (3,800 + 18% → 4,500). */
export const roundPrice = (n: number) => Math.round(n / 50) * 50;

/**
 * Nightly price = highest-priority matching rule, by precedence season > weekday uplift > base.
 * A season inside which a weekend falls wins over the weekend uplift.
 */
export function priceNight(date: LocalDate, rules: PriceRule[]): NightPrice {
  const matching = rules.filter((r) => inRange(r, date) && onDay(r, date));
  const base = best(matching.filter((r) => r.type === "base"));
  if (!base || base.amount == null) throw new Error(`No base price for ${date}`);
  const baseMin = base.minNights ?? 1;
  const season = best(matching.filter((r) => r.type === "season"));
  if (season) {
    const amount = season.amount ?? roundPrice(base.amount * (1 + (season.percent ?? 0) / 100));
    return { date, amount, tier: "season", ruleId: season.id, minNights: Math.max(season.minNights ?? baseMin, 1) };
  }
  const uplift = best(matching.filter((r) => r.type === "weekday_uplift"));
  if (uplift) {
    const amount = uplift.amount ?? roundPrice(base.amount * (1 + (uplift.percent ?? 0) / 100));
    return { date, amount, tier: "weekend", ruleId: uplift.id, minNights: Math.max(uplift.minNights ?? baseMin, 1) };
  }
  return { date, amount: base.amount, tier: "regular", ruleId: base.id, minNights: Math.max(baseMin, 1) };
}

export interface StayQuote {
  checkIn: LocalDate;
  checkOut: LocalDate;
  nights: NightPrice[];
  tiers: { tier: NightTier; count: number; amount: number }[];
  subtotal: number;
  discount: number;
  discountLabel: string | null;
  nightsTotal: number; // subtotal - discount
  minNights: number;
  meetsMinNights: boolean;
}

/** Prices every night, applies the strongest length-of-stay discount, and reports the min-nights rule in force. */
export function quoteStay(checkIn: LocalDate, checkOut: LocalDate, rules: PriceRule[], discounts: LengthOfStayDiscount[] = []): StayQuote {
  if (!(checkOut > checkIn)) throw new Error("check-out must be after check-in");
  const nights = nightsBetween(checkIn, checkOut).map((d) => priceNight(d, rules));
  const subtotal = nights.reduce((s, n) => s + n.amount, 0);
  const los = discounts.filter((d) => nights.length >= d.minNights).sort((a, b) => b.percent - a.percent)[0];
  const discount = los ? Math.round((subtotal * los.percent) / 100) : 0;
  const minNights = Math.max(...nights.map((n) => n.minNights));
  const tiers = (["regular", "weekend", "season"] as NightTier[])
    .map((tier) => ({ tier, count: nights.filter((n) => n.tier === tier).length, amount: nights.filter((n) => n.tier === tier).reduce((s, n) => s + n.amount, 0) }))
    .filter((t) => t.count > 0);
  return {
    checkIn,
    checkOut,
    nights,
    tiers,
    subtotal,
    discount,
    discountLabel: los?.label ?? (los ? `${los.percent}%` : null),
    nightsTotal: subtotal - discount,
    minNights,
    meetsMinNights: nights.length >= minNights,
  };
}

export interface DateBlock {
  start: LocalDate;
  end: LocalDate; // exclusive
}

/** True when no block overlaps [checkIn, checkOut). */
export function isRangeFree(checkIn: LocalDate, checkOut: LocalDate, blocks: DateBlock[]): boolean {
  return !blocks.some((b) => rangesOverlap(checkIn, checkOut, b.start, b.end));
}

/** Nights (dates) that are blocked within [from, to). */
export function blockedNights(from: LocalDate, to: LocalDate, blocks: DateBlock[]): Set<LocalDate> {
  const out = new Set<LocalDate>();
  for (const b of blocks) for (const d of nightsBetween(b.start > from ? b.start : from, b.end < to ? b.end : to)) out.add(d);
  return out;
}
