import { describe, expect, it } from "vitest";
import { get, run } from "@/lib/db";
import { applyFeedEvents, exportIcal, parseIcal, syncFeed, verifyExportToken, exportToken } from "@/market/ical";
import { createHold, isAvailable } from "@/market/booking";
import { freshDb, NAWRAS, NOW } from "./helpers";

const AIRBNB = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN\r
BEGIN:VEVENT\r
DTEND;VALUE=DATE:20270920\r
DTSTART;VALUE=DATE:20270917\r
UID:1418fb94e984-abc@airbnb.com\r
SUMMARY:Reserved\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20271001\r
DTEND;VALUE=DATE:20271003\r
UID:cancelled-1@airbnb.com\r
STATUS:CANCELLED\r
SUMMARY:Airbnb (Not available)\r
END:VEVENT\r
END:VCALENDAR\r
`;

describe("iCal", () => {
  it("parses all-day events and skips cancelled ones (incl. folded lines)", () => {
    const ev = parseIcal(AIRBNB.replace("UID:1418fb94e984-abc@airbnb.com", "UID:1418fb94e984-\r\n abc@airbnb.com"));
    expect(ev).toEqual([{ uid: "1418fb94e984-abc@airbnb.com", start: "2027-09-17", end: "2027-09-20", summary: "Reserved" }]);
  });

  it("an event added to the feed blocks the dates after sync; deleting it frees them; re-sync is idempotent", async () => {
    const { db } = freshDb();
    const feed = get<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE listing_id = ?", NAWRAS)!.id;
    let text = AIRBNB;
    const fetcher = async () => text;
    expect(isAvailable(db, NAWRAS, "2027-09-17", "2027-09-20")).toBe(true);
    const r1 = await syncFeed(db, feed, NOW, fetcher);
    expect(r1.added).toBe(1);
    expect(r1.removed).toBe(1); // the seeded Laura M. event is no longer in this feed
    expect(isAvailable(db, NAWRAS, "2027-09-18", "2027-09-19")).toBe(false);
    expect(() => createHold(db, { listingId: NAWRAS, checkIn: "2027-09-18", checkOut: "2027-09-21", guests: 2 }, NOW)).toThrow(/DATES_TAKEN/);
    const r2 = await syncFeed(db, feed, NOW, fetcher);
    expect(r2).toMatchObject({ added: 0, updated: 0, removed: 0 });
    text = AIRBNB.replace(/BEGIN:VEVENT\r\nDTEND;VALUE=DATE:20270920[\s\S]*?END:VEVENT\r\n/, "");
    const r3 = await syncFeed(db, feed, NOW, fetcher);
    expect(r3.removed).toBe(1);
    expect(isAvailable(db, NAWRAS, "2027-09-17", "2027-09-20")).toBe(true);
  });

  it("a moved event moves the block", () => {
    const { db } = freshDb();
    const feed = get<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE listing_id = ?", NAWRAS)!.id;
    applyFeedEvents(db, feed, [{ uid: "airbnb-HM4KX2-laura", start: "2027-08-09", end: "2027-08-11", summary: "x" }]);
    const r = applyFeedEvents(db, feed, [{ uid: "airbnb-HM4KX2-laura", start: "2027-09-01", end: "2027-09-03", summary: "x" }]);
    expect(r.updated).toBe(1);
    expect(isAvailable(db, NAWRAS, "2027-08-09", "2027-08-11")).toBe(true);
    expect(isAvailable(db, NAWRAS, "2027-09-01", "2027-09-03")).toBe(false);
  });

  it("an imported event overlapping one of our bookings is kept and flagged as a conflict", () => {
    const { db } = freshDb();
    const feed = get<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE listing_id = ?", NAWRAS)!.id;
    const r = applyFeedEvents(db, feed, [{ uid: "clash", start: "2027-08-04", end: "2027-08-05", summary: "Reserved" }]);
    expect(r.conflicts).toBe(1);
    expect(get(db, "SELECT conflict FROM calendar_blocks WHERE external_uid = 'clash'")).toEqual({ conflict: 1 });
  });

  it("feed errors are recorded and don't touch existing blocks", async () => {
    const { db } = freshDb();
    const feed = get<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE listing_id = ?", NAWRAS)!.id;
    const r = await syncFeed(db, feed, NOW, async () => "<html>login</html>");
    expect(r.error).toBeTruthy();
    expect(get(db, "SELECT last_status FROM ical_feeds WHERE id = ?", feed)).toEqual({ last_status: "error" });
    expect(isAvailable(db, NAWRAS, "2027-08-09", "2027-08-11")).toBe(false);
  });

  it("export contains every active block, and the URL token is signed", () => {
    const { db } = freshDb();
    const ics = exportIcal(db, NAWRAS);
    expect(ics).toContain("DTSTART;VALUE=DATE:20270803");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270809");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270821");
    const raw = get<{ ical_export_token: string }>(db, "SELECT ical_export_token FROM listings WHERE id = ?", NAWRAS)!.ical_export_token;
    expect(verifyExportToken(exportToken(raw))).toBe(raw);
    expect(verifyExportToken(`${raw}.deadbeefdeadbeefdeadbeef`)).toBeNull();
    run(db, "SELECT 1");
  });
});
