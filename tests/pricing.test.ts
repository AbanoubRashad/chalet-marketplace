import { describe, expect, it } from "vitest";
import { isRangeFree, priceNight, quoteStay, rangesOverlap, type PriceRule } from "@/booking-engine";

// Nawras chalet rules from the brief: regular 3,800 · Thu/Fri +18% · season 5,500 (min 3) · min 2 · weekly 10%.
const RULES: PriceRule[] = [
  { id: 1, type: "base", amount: 3800, minNights: 2 },
  { id: 2, type: "weekday_uplift", percent: 18, weekdays: [4, 5] },
  { id: 3, type: "season", startDate: "2027-08-10", endDate: "2027-08-12", amount: 5500, minNights: 3, priority: 10 },
  { id: 4, type: "season", startDate: "2027-08-11", endDate: "2027-08-15", amount: 6000, minNights: 4, priority: 20 },
];
const WEEKLY = [{ minNights: 7, percent: 10, label: "weekly" }];

describe("nightly price rules", () => {
  it("regular night uses the base", () => {
    expect(priceNight("2027-08-02", RULES)).toMatchObject({ amount: 3800, tier: "regular" }); // Monday
  });
  it("Thursday and Friday get the weekend uplift (rounded to 50)", () => {
    expect(priceNight("2027-08-05", RULES)).toMatchObject({ amount: 4500, tier: "weekend" }); // Thu
    expect(priceNight("2027-08-06", RULES)).toMatchObject({ amount: 4500, tier: "weekend" }); // Fri
    expect(priceNight("2027-08-07", RULES).tier).toBe("regular"); // Sat
  });
  it("a season wins over the weekend uplift inside it", () => {
    expect(priceNight("2027-08-12", RULES)).toMatchObject({ amount: 6000, tier: "season" }); // Thu inside the 11–15 season
  });
  it("overlapping seasons: the higher priority wins", () => {
    expect(priceNight("2027-08-10", RULES).amount).toBe(5500);
    expect(priceNight("2027-08-11", RULES).amount).toBe(6000);
  });
});

describe("stay quote", () => {
  it("min nights: 2 normally, the season's minimum when any night falls in a season", () => {
    expect(quoteStay("2027-08-02", "2027-08-03", RULES).meetsMinNights).toBe(false);
    expect(quoteStay("2027-08-02", "2027-08-04", RULES).meetsMinNights).toBe(true);
    const q = quoteStay("2027-08-09", "2027-08-12", RULES); // touches both seasons
    expect(q.minNights).toBe(4);
    expect(q.meetsMinNights).toBe(false);
    expect(quoteStay("2027-08-08", "2027-08-12", RULES).meetsMinNights).toBe(true);
  });
  it("check-out night is not charged; tiers add up", () => {
    const q = quoteStay("2027-08-05", "2027-08-08", RULES); // Thu, Fri, Sat
    expect(q.nights.map((n) => n.amount)).toEqual([4500, 4500, 3800]);
    expect(q.subtotal).toBe(12800);
    expect(q.tiers).toEqual([
      { tier: "regular", count: 1, amount: 3800 },
      { tier: "weekend", count: 2, amount: 9000 },
    ]);
  });
  it("weekly discount applies after per-night pricing from 7 nights", () => {
    expect(quoteStay("2027-09-01", "2027-09-07", RULES, WEEKLY).discount).toBe(0);
    const q = quoteStay("2027-09-01", "2027-09-08", RULES, WEEKLY);
    expect(q.discount).toBe(Math.round(q.subtotal * 0.1));
    expect(q.nightsTotal).toBe(q.subtotal - q.discount);
  });
});

describe("availability", () => {
  const blocks = [{ start: "2027-08-03", end: "2027-08-06" }];
  it("turnover: a check-out day can be the next check-in day", () => {
    expect(isRangeFree("2027-08-06", "2027-08-08", blocks)).toBe(true);
    expect(isRangeFree("2027-08-01", "2027-08-03", blocks)).toBe(true);
  });
  it("any overlapping night blocks", () => {
    expect(isRangeFree("2027-08-05", "2027-08-07", blocks)).toBe(false);
    expect(isRangeFree("2027-08-01", "2027-08-10", blocks)).toBe(false);
    expect(rangesOverlap("2027-08-04", "2027-08-05", "2027-08-03", "2027-08-06")).toBe(true);
  });
});
