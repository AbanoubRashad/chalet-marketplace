// iCal (RFC 5545) export and import for Airbnb / Booking.com calendar sync.
// Both platforms publish all-day VEVENTs (DTSTART;VALUE=DATE / DTEND exclusive) and poll exported
// feeds on their own schedule (typically every few hours), so sync is never instant: see ARCHITECTURE.md.
import { all, get, run, transaction, type DB } from "@/lib/db";
import { hmacHex, safeEqualHex, secret } from "@/lib/crypto";
import { activeBlocks, audit, SYSTEM } from "./repo";

export interface IcalEvent {
  uid: string;
  start: string; // YYYY-MM-DD
  end: string; // exclusive
  summary: string;
}

const toDate = (v: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Minimal tolerant parser: unfolds lines, reads VEVENT UID/DTSTART/DTEND/SUMMARY, ignores cancelled events. */
export function parseIcal(text: string): IcalEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: IcalEvent[] = [];
  let cur: Partial<IcalEvent> & { status?: string } | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      if (cur.uid && cur.start && cur.status !== "CANCELLED") {
        const end = cur.end && cur.end > cur.start ? cur.end : nextDay(cur.start);
        out.push({ uid: cur.uid, start: cur.start, end, summary: cur.summary ?? "" });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).split(";")[0]!.toUpperCase();
      const val = line.slice(idx + 1);
      if (key === "UID") cur.uid = val.trim();
      else if (key === "DTSTART") cur.start = toDate(val) ?? undefined;
      else if (key === "DTEND") cur.end = toDate(val) ?? undefined;
      else if (key === "SUMMARY") cur.summary = val.replace(/\\,/g, ",").replace(/\\n/g, " ").trim();
      else if (key === "STATUS") cur.status = val.trim().toUpperCase();
    }
  }
  return out;
}

function nextDay(d: string) {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
const compact = (d: string) => d.replace(/-/g, "");

/** Export feed: every active block (bookings, owner blocks, imports) as an anonymous "Not available" event. */
export function exportIcal(db: DB, listingId: number, brand = "Masyaf"): string {
  const blocks = activeBlocks(db, listingId);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${brand}//Calendar//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...blocks.flatMap((b) => [
      "BEGIN:VEVENT",
      `UID:block-${b.id}@${brand.toLowerCase()}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(b.start_date)}`,
      `DTEND;VALUE=DATE:${compact(b.end_date)}`,
      `SUMMARY:${esc(`${brand} (Not available)`)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Unguessable export URL token: random per listing + HMAC so it can be rotated by changing the secret. */
export function exportToken(listingToken: string) {
  return `${listingToken}.${hmacHex("sha256", secret("ICAL_SIGNING_KEY"), listingToken).slice(0, 24)}`;
}
export function verifyExportToken(token: string) {
  const [raw, sig] = token.replace(/\.ics$/, "").split(".");
  if (!raw || !sig) return null;
  return safeEqualHex(hmacHex("sha256", secret("ICAL_SIGNING_KEY"), raw).slice(0, 24), sig) ? raw : null;
}

export interface SyncResult {
  feedId: number;
  added: number;
  updated: number;
  removed: number;
  conflicts: number;
  error?: string;
}

/**
 * Idempotent import keyed by (feed, UID): new events block dates, changed events move, events that
 * disappeared from the feed free their dates. Events overlapping one of our bookings are kept and
 * flagged as conflicts for an admin (the double booking already happened elsewhere).
 */
export function applyFeedEvents(db: DB, feedId: number, events: IcalEvent[], now: Date = new Date()): SyncResult {
  const feed = get<{ id: number; listing_id: number; provider: string }>(db, "SELECT * FROM ical_feeds WHERE id = ?", feedId);
  if (!feed) throw new Error("feed not found");
  const r: SyncResult = { feedId, added: 0, updated: 0, removed: 0, conflicts: 0 };
  transaction(db, () => {
    const existing = all<{ id: number; external_uid: string; start_date: string; end_date: string; status: string }>(
      db,
      "SELECT id, external_uid, start_date, end_date, status FROM calendar_blocks WHERE feed_id = ?",
      feedId,
    );
    const byUid = new Map(existing.map((e) => [e.external_uid, e]));
    const seen = new Set<string>();
    for (const ev of events) {
      seen.add(ev.uid);
      const conflict = get(
        db,
        "SELECT 1 FROM calendar_blocks WHERE listing_id = ? AND status = 'active' AND source = 'booking' AND start_date < ? AND end_date > ?",
        feed.listing_id,
        ev.end,
        ev.start,
      )
        ? 1
        : 0;
      const prev = byUid.get(ev.uid);
      if (!prev) {
        run(
          db,
          "INSERT INTO calendar_blocks (listing_id, start_date, end_date, source, feed_id, external_uid, summary, conflict) VALUES (?,?,?, 'ical_import', ?,?,?,?)",
          feed.listing_id,
          ev.start,
          ev.end,
          feedId,
          ev.uid,
          `${feed.provider}${ev.summary ? ` · ${ev.summary}` : ""}`,
          conflict,
        );
        r.added++;
      } else if (prev.start_date !== ev.start || prev.end_date !== ev.end || prev.status !== "active") {
        run(db, "UPDATE calendar_blocks SET start_date = ?, end_date = ?, status = 'active', conflict = ?, summary = ? WHERE id = ?", ev.start, ev.end, conflict, `${feed.provider}${ev.summary ? ` · ${ev.summary}` : ""}`, prev.id);
        r.updated++;
      }
      r.conflicts += conflict;
    }
    for (const e of existing) if (!seen.has(e.external_uid) && e.status === "active") {
      run(db, "UPDATE calendar_blocks SET status = 'released' WHERE id = ?", e.id);
      r.removed++;
    }
    run(db, "UPDATE ical_feeds SET last_sync_at = ?, last_status = 'ok', last_error = NULL, events_count = ? WHERE id = ?", now.toISOString(), events.length, feedId);
    if (r.conflicts) audit(db, SYSTEM, "ical.conflict", "ical_feed", feedId, null, { conflicts: r.conflicts });
  });
  return r;
}

/** Fetches and applies one feed. Feeds on this server (the demo "Airbnb") are read directly. */
export async function syncFeed(db: DB, feedId: number, now: Date = new Date(), fetcher: (url: string) => Promise<string> = defaultFetch(db)): Promise<SyncResult> {
  const feed = get<{ id: number; url: string }>(db, "SELECT * FROM ical_feeds WHERE id = ?", feedId);
  if (!feed) throw new Error("feed not found");
  try {
    const text = await fetcher(feed.url);
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Not an iCal feed");
    return applyFeedEvents(db, feedId, parseIcal(text), now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    run(db, "UPDATE ical_feeds SET last_sync_at = ?, last_status = 'error', last_error = ? WHERE id = ?", now.toISOString(), msg.slice(0, 300), feedId);
    return { feedId, added: 0, updated: 0, removed: 0, conflicts: 0, error: msg };
  }
}

function defaultFetch(db: DB) {
  return async (url: string) => {
    const demo = /\/api\/demo-feeds\/([\w-]+)\.ics$/.exec(url);
    if (demo) return demoFeed(db, demo[1]!);
    const res = await fetch(url, { headers: { "User-Agent": "Masyaf-calendar-sync/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
}

/** The demo stand-in for an Airbnb/Booking.com export feed. */
export function demoFeed(db: DB, key: string) {
  const events = all<{ uid: string; start_date: string; end_date: string; summary: string }>(db, "SELECT * FROM demo_feed_events WHERE feed_key = ? ORDER BY start_date", key);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `DTEND;VALUE=DATE:${compact(e.end_date)}`, `DTSTART;VALUE=DATE:${compact(e.start_date)}`, `UID:${e.uid}`, `SUMMARY:${e.summary}`, "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export async function syncAllFeeds(db: DB, now: Date = new Date(), olderThanMinutes = 0) {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();
  const feeds = all<{ id: number }>(db, "SELECT id FROM ical_feeds WHERE last_sync_at IS NULL OR last_sync_at <= ?", cutoff);
  const results: SyncResult[] = [];
  for (const f of feeds) results.push(await syncFeed(db, f.id, now));
  return results;
}
